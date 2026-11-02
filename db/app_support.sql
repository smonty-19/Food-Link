/* ======================================================================
   FoodLink: app_support.sql
   Objects the web application needs on top of review2.sql.
   Nothing here changes a Review 2 object; it only adds to them.

   HOW TO RUN (after review2.sql):
       psql -U postgres -d foodlink -f db/app_support.sql

   CONTENTS
     1  sessions table (login sessions for the web app)
     2  browse_available_donations()  : map / search page, stage 2 of matching
     3  allocate_donation_slow()      : safe allocation that holds the row lock
                                        longer (two-browser and race demos)
     4  allocate_donation_unsafe()    : DEMO ONLY, no row lock
     5  demo helpers                  : fresh race donation + claimant list
     6  donation_timeline()           : audit trail, visible only to the parties
     7  privileges
   ====================================================================== */

\set ON_ERROR_STOP on
SET search_path TO public;
SET client_min_messages = warning;


/* ----------------------------------------------------------------------
   1. SESSIONS
   One row per logged-in browser. The cookie holds only session_id; the
   user is looked up on every request, so deactivating a user or deleting
   the row logs them out immediately.
   ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS sessions (
    session_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    CONSTRAINT chk_session_window CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);


/* ----------------------------------------------------------------------
   2. browse_available_donations
   Used by the recipient "browse" map and the free-text search box.
   Same idea as find_matching_donations, but driven by a location instead
   of a requirement:
     - p_candidate_ids = ranked IDs from Qdrant (semantic recall), or NULL
       for a plain "everything near me" listing
     - PostgreSQL applies the hard constraints and keeps Qdrant's order
   ---------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION browse_available_donations(
    p_lat           DOUBLE PRECISION,
    p_lng           DOUBLE PRECISION,
    p_radius_km     DOUBLE PRECISION DEFAULT 15,
    p_candidate_ids UUID[]           DEFAULT NULL,
    p_exclude_org   UUID             DEFAULT NULL)     -- the viewer's own org
RETURNS TABLE (donation_id     UUID,
               description     TEXT,
               donor_org       TEXT,
               servings        NUMERIC,
               dietary_tags    TEXT[],
               items           TEXT,
               pickup_lat      DOUBLE PRECISION,
               pickup_lng      DOUBLE PRECISION,
               distance_km     NUMERIC,
               hours_to_expiry NUMERIC,
               semantic_rank   INTEGER)
LANGUAGE sql STABLE AS $$
    SELECT d.donation_id,
           d.description,
           o.name::TEXT,
           d.quantity,
           d.dietary_tags,
           (SELECT string_agg(f.name || ' (' || f.quantity || ' ' || f.unit || ')', ', ' ORDER BY f.name)
              FROM food_items f WHERE f.donation_id = d.donation_id),
           d.pickup_lat,
           d.pickup_lng,
           round(haversine_km(p_lat, p_lng, d.pickup_lat, d.pickup_lng)::NUMERIC, 2),
           round((extract(epoch FROM d.expires_at - now()) / 3600)::NUMERIC, 1),
           array_position(p_candidate_ids, d.donation_id)
      FROM donations d
      JOIN organizations o ON o.org_id = d.org_id
     WHERE d.status = 'AVAILABLE'
       AND d.expires_at > now()                                   -- never trust a stale status
       AND (p_exclude_org   IS NULL OR d.org_id <> p_exclude_org)
       AND (p_candidate_ids IS NULL OR d.donation_id = ANY (p_candidate_ids))
       AND haversine_km(p_lat, p_lng, d.pickup_lat, d.pickup_lng) <= p_radius_km
     ORDER BY array_position(p_candidate_ids, d.donation_id) NULLS LAST,   -- Qdrant's rank first
              d.expires_at;                                                -- else soonest expiry
$$;


/* ----------------------------------------------------------------------
   3. allocate_donation_slow
   Takes the SAME row lock as allocate_donation, holds it for p_delay_ms,
   then calls the real allocate_donation (re-locking a row we already hold
   is a no-op). Used to make the lock queue visible:
     - two browsers: the second one visibly waits ~3 s, then gets a clean
       "not available" error
     - race panel: latency climbs claimer by claimer
   ---------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION allocate_donation_slow(p_donation_id    UUID,
                                                  p_requirement_id UUID,
                                                  p_user_id        UUID,
                                                  p_delay_ms       INTEGER DEFAULT 3000)
RETURNS UUID
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM donations WHERE donation_id = p_donation_id FOR UPDATE;   -- >>> ROW LOCK <<<
    IF p_delay_ms > 0 THEN
        PERFORM pg_sleep(p_delay_ms / 1000.0);
    END IF;
    RETURN allocate_donation(p_donation_id, p_requirement_id, p_user_id);
END;
$$;


/* ----------------------------------------------------------------------
   4. allocate_donation_unsafe   !!! DEMO ONLY !!!
   The classic read-check-write bug: read the status WITHOUT a lock, wait,
   then insert. Every concurrent caller sees AVAILABLE and passes the check.
   What still saves the data is the partial unique index from Review 2:
       idx_allocations_one_active ON allocations (donation_id)
                                  WHERE status <> 'cancelled'
   so all but one caller fail with 23505 (unique_violation). The demo
   contrasts this "last line of defense" with the clean queue in SAFE mode.
   ---------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION allocate_donation_unsafe(p_donation_id    UUID,
                                                    p_requirement_id UUID,
                                                    p_user_id        UUID,
                                                    p_delay_ms       INTEGER DEFAULT 300)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_status donation_status;
    v_org    UUID;
    v_id     UUID;
BEGIN
    SELECT status INTO v_status FROM donations WHERE donation_id = p_donation_id;   -- NO LOCK (the bug)
    IF v_status IS DISTINCT FROM 'AVAILABLE' THEN
        RAISE EXCEPTION 'Donation % is not available (status: %)', p_donation_id, v_status;
    END IF;

    PERFORM pg_sleep(p_delay_ms / 1000.0);                                         -- widen the race window

    SELECT org_id INTO v_org FROM requirements WHERE requirement_id = p_requirement_id;
    INSERT INTO allocations (donation_id, requirement_id, recipient_org_id, allocated_by, quantity)
    VALUES (p_donation_id, p_requirement_id, v_org, p_user_id, 1)                  -- trigger B.T1 fixes quantity
    RETURNING allocation_id INTO v_id;
    RETURN v_id;
END;
$$;


/* ----------------------------------------------------------------------
   5. DEMO HELPERS
   Each race run uses a brand-new donation, so no reset logic is needed
   and the Review 2 data is never disturbed. Demo listings are labelled
   "[demo]" in their description.
   ---------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION demo_create_race_donation(p_servings NUMERIC DEFAULT 20)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_user UUID;
    v_org  UUID;
    v_id   UUID;
BEGIN
    SELECT user_id, org_id INTO v_user, v_org FROM users WHERE email = 'ravi@annapoorna.in';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Demo donor ravi@annapoorna.in is missing; run review2.sql first';
    END IF;

    -- All eight tags, so every active requirement's diet is satisfied
    CALL create_donation(v_org, v_user,
                         '[demo] Race test: veg thali boxes',
                         ARRAY['vegetarian', 'vegan', 'jain', 'halal', 'eggless',
                               'nut_free', 'gluten_free', 'dairy_free'],
                         p_servings, interval '6 hours',
                         jsonb_build_array(jsonb_build_object(
                             'name', 'Veg thali box', 'quantity', p_servings, 'unit', 'boxes')),
                         v_id);
    CALL publish_donation(v_id);
    RETURN v_id;
END;
$$;

-- Requirements that could legally take a donation: active, different org,
-- posted by an active recipient user, diet and capacity satisfied.
CREATE OR REPLACE FUNCTION demo_race_claimants(p_donation_id UUID)
RETURNS TABLE (requirement_id UUID, user_id UUID, org_id UUID, org_name TEXT)
LANGUAGE sql STABLE AS $$
    SELECT r.requirement_id, u.user_id, r.org_id, o.name::TEXT
      FROM donations d
      JOIN requirements r  ON r.active
                          AND r.org_id <> d.org_id
                          AND d.dietary_tags @> r.dietary_constraints
                          AND d.quantity <= r.max_capacity
      JOIN users u         ON u.user_id = r.created_by AND u.role = 'recipient' AND u.is_active
      JOIN organizations o ON o.org_id = r.org_id
     WHERE d.donation_id = p_donation_id
     ORDER BY r.created_at;
$$;


/* ----------------------------------------------------------------------
   6. donation_timeline
   status_history is INSERT-only for the app role (review2.sql, Section 10),
   so the app cannot read it directly. This SECURITY DEFINER function runs
   with its owner's rights but only returns a donation's history to the
   organization that listed it or one that was allocated it. The access rule
   is enforced in the database, not in application code.
   search_path is pinned, as required for any SECURITY DEFINER function.
   ---------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION donation_timeline(p_donation_id UUID)
RETURNS TABLE (entity_type     VARCHAR,
               old_status      VARCHAR,
               new_status      VARCHAR,
               changed_at      TIMESTAMPTZ,
               db_user         NAME,
               changed_by_name VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT h.entity_type, h.old_status, h.new_status, h.changed_at, h.db_user, u.name
      FROM status_history h
      LEFT JOIN users u ON u.user_id = h.changed_by
     WHERE h.donation_id = p_donation_id
       AND (EXISTS (SELECT 1 FROM donations d
                     WHERE d.donation_id = p_donation_id AND d.org_id = current_org_id())
            OR EXISTS (SELECT 1 FROM allocations a
                        WHERE a.donation_id = p_donation_id AND a.recipient_org_id = current_org_id()))
     ORDER BY h.changed_at, h.history_id;
$$;


/* ----------------------------------------------------------------------
   7. PRIVILEGES (same least-privilege model as review2.sql Section 10)
   ---------------------------------------------------------------------- */
REVOKE ALL ON sessions FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON sessions TO foodlink_app;
GRANT ALL PRIVILEGES         ON sessions TO foodlink_admin;

REVOKE ALL ON FUNCTION
      browse_available_donations(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID[], UUID),
      allocate_donation_slow(UUID, UUID, UUID, INTEGER),
      allocate_donation_unsafe(UUID, UUID, UUID, INTEGER),
      demo_create_race_donation(NUMERIC),
      demo_race_claimants(UUID),
      donation_timeline(UUID)
   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
      browse_available_donations(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID[], UUID),
      allocate_donation_slow(UUID, UUID, UUID, INTEGER),
      allocate_donation_unsafe(UUID, UUID, UUID, INTEGER),
      donation_timeline(UUID)
   TO foodlink_app;

GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO foodlink_admin;
-- PostgreSQL 17+: MAINTAIN lets the admin role refresh the materialized view
GRANT MAINTAIN ON mv_donor_impact TO foodlink_admin;

\echo 'app_support.sql applied'
