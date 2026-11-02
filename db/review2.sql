/* ======================================================================
   FoodLink: Surplus Food Redistribution Platform  (Group 19)
   Review 2 script: DDL changes, data, queries, programmable objects,
   roles, row-level security, tests

   Members : Shreyas Mohanty (PES2UG24CS491)  - Part A
             Shreya Ajith    (PES2UG24CS480)  - Part B
   Part A  : organizations, users, donations, food_items, status_history
             (+ vector_sync_outbox for the Qdrant index)
   Part B  : requirements, allocations, pickups
   Target  : PostgreSQL 17 (database "foodlink" created in Review 1)

   HOW TO RUN (from PowerShell, in the folder containing this file):
       psql -U postgres -d foodlink -f PES2UG24CS491_PES2UG24CS480_DBMS.sql

   The 8 tables already exist from Review 1, so this script does NOT create
   them. It ALTERs them, loads seed data and builds everything on top.

   SECTIONS
     0  Reset (clears rows and objects from earlier runs; tables are kept)
     1  Part A: DDL changes
     2  Part B: DDL changes
     3  Part A: INSERTs
     4  Part B: INSERTs
     5  UPDATE / DELETE examples (Part A, then Part B)
     6  Part A queries
     7  Part B queries
     8  Views, materialized view, functions, procedures (A and B)
     9  Triggers (A and B)   <- created after seed data so it is not re-validated
     10 Roles and privileges
     11 Row-level security
     12 Tests for the programmable objects
     13 Negative tests (each one is meant to FAIL with an ERROR)
     14 Live concurrency demo (manual, two psql terminals)

   NOTE: Section 0 TRUNCATEs all 8 tables so the script is safely re-runnable.
   ====================================================================== */

\set ON_ERROR_STOP on
\pset null '(null)'
SET search_path TO public;
-- Hide informational NOTICEs (e.g. "does not exist, skipping"); real errors still show
SET client_min_messages = warning;


/* ======================================================================
   SECTION 0: RESET (tables from Review 1 are kept)
   ====================================================================== */
\echo '==================== SECTION 0: EXISTING TABLES AND RESET ===================='
\dt public.*

-- Objects created by an earlier run of this script
DROP MATERIALIZED VIEW IF EXISTS mv_donor_impact;
DROP VIEW IF EXISTS v_available_donations, v_allocation_details;
DROP TABLE IF EXISTS vector_sync_outbox;

-- Triggers from an earlier run (re-created in Section 9, after the seed data)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT t.tgname, t.tgrelid::regclass AS tbl
          FROM pg_trigger t
         WHERE NOT t.tgisinternal
           AND t.tgrelid IN ('organizations'::regclass, 'users'::regclass, 'donations'::regclass,
                             'food_items'::regclass, 'requirements'::regclass, 'allocations'::regclass,
                             'pickups'::regclass, 'status_history'::regclass)
    LOOP
        EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.tbl);
    END LOOP;
END
$$;

TRUNCATE organizations, users, donations, food_items, requirements,
         allocations, pickups, status_history CASCADE;


/* ======================================================================
   SECTION 1: PART A, DDL CHANGES
   Tables: organizations, users, donations, food_items, status_history
   ====================================================================== */
\echo '==================== SECTION 1: PART A DDL CHANGES ===================='

-- 1.1 New columns
ALTER TABLE users          ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE donations      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- which database role made the change (app login vs admin vs scheduled job)
ALTER TABLE status_history ADD COLUMN IF NOT EXISTS db_user    NAME NOT NULL DEFAULT current_user;

-- 1.2 NOT NULL tightening (these columns had defaults but still allowed NULL)
ALTER TABLE organizations  ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE users          ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE donations      ALTER COLUMN status     SET NOT NULL,
                           ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE status_history ALTER COLUMN changed_at SET NOT NULL;
-- The first history row of an entity has no previous status
ALTER TABLE status_history ALTER COLUMN old_status DROP NOT NULL;
-- A listing must survive if the account that posted it is removed (see 1.3)
ALTER TABLE donations      ALTER COLUMN created_by DROP NOT NULL;

-- 1.3 Foreign keys: ON DELETE / ON UPDATE rules
-- Review 1 used ON DELETE CASCADE from organizations. Deleting an organization
-- would silently wipe its users and donations, so these become RESTRICT.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_org_id_fkey;
ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_org;
ALTER TABLE users ADD CONSTRAINT fk_users_org
    FOREIGN KEY (org_id) REFERENCES organizations(org_id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE donations DROP CONSTRAINT IF EXISTS donations_org_id_fkey;
ALTER TABLE donations DROP CONSTRAINT IF EXISTS fk_donations_org;
ALTER TABLE donations ADD CONSTRAINT fk_donations_org
    FOREIGN KEY (org_id) REFERENCES organizations(org_id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the listing, forget the person
ALTER TABLE donations DROP CONSTRAINT IF EXISTS donations_created_by_fkey;
ALTER TABLE donations DROP CONSTRAINT IF EXISTS fk_donations_created_by;
ALTER TABLE donations ADD CONSTRAINT fk_donations_created_by
    FOREIGN KEY (created_by) REFERENCES users(user_id)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- food_items stay ON DELETE CASCADE: line items belong to their donation
ALTER TABLE food_items DROP CONSTRAINT IF EXISTS food_items_donation_id_fkey;
ALTER TABLE food_items DROP CONSTRAINT IF EXISTS fk_food_items_donation;
ALTER TABLE food_items ADD CONSTRAINT fk_food_items_donation
    FOREIGN KEY (donation_id) REFERENCES donations(donation_id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- History keeps its rows if the user is removed
ALTER TABLE status_history DROP CONSTRAINT IF EXISTS status_history_changed_by_fkey;
ALTER TABLE status_history DROP CONSTRAINT IF EXISTS fk_history_changed_by;
ALTER TABLE status_history ADD CONSTRAINT fk_history_changed_by
    FOREIGN KEY (changed_by) REFERENCES users(user_id)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 1.4 CHECK constraints
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS chk_org_coordinates;
ALTER TABLE organizations ADD  CONSTRAINT chk_org_coordinates
    CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180);

ALTER TABLE donations DROP CONSTRAINT IF EXISTS chk_donation_coordinates;
ALTER TABLE donations ADD  CONSTRAINT chk_donation_coordinates
    CHECK (pickup_lat BETWEEN -90 AND 90 AND pickup_lng BETWEEN -180 AND 180);

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_user_email_format;
ALTER TABLE users ADD  CONSTRAINT chk_user_email_format
    CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Dietary tags come from a fixed vocabulary so array matching is reliable
ALTER TABLE donations DROP CONSTRAINT IF EXISTS chk_donation_dietary_tags;
ALTER TABLE donations ADD  CONSTRAINT chk_donation_dietary_tags
    CHECK (dietary_tags <@ ARRAY['vegetarian', 'vegan', 'jain', 'halal', 'eggless',
                                 'nut_free', 'gluten_free', 'dairy_free']::TEXT[]);

-- A history row must point at the entity it describes
ALTER TABLE status_history DROP CONSTRAINT IF EXISTS chk_history_entity_ref;
ALTER TABLE status_history ADD  CONSTRAINT chk_history_entity_ref
    CHECK ((entity_type = 'donation'   AND donation_id   IS NOT NULL) OR
           (entity_type = 'allocation' AND allocation_id IS NOT NULL));

-- 1.5 Indexes  (Review 1 already has idx_donations_available_expiry,
--               idx_donations_status and the status_history FK indexes)
-- Expression index: case-insensitive unique email (Anita@x.org == anita@x.org)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_org            ON users (org_id);
-- Composite: donor dashboard "my donations by status"
CREATE INDEX IF NOT EXISTS idx_donations_org_status ON donations (org_id, status);
CREATE INDEX IF NOT EXISTS idx_donations_created_by ON donations (created_by);
-- Composite: bounding-box prefilter before exact distance in matching
CREATE INDEX IF NOT EXISTS idx_donations_geo        ON donations (pickup_lat, pickup_lng);
-- GIN on an array: "donation tags contain every tag the NGO requires" (@>)
CREATE INDEX IF NOT EXISTS idx_donations_tags_gin   ON donations USING GIN (dietary_tags);
-- GIN expression index for full-text search on the description
CREATE INDEX IF NOT EXISTS idx_donations_fts        ON donations
    USING GIN (to_tsvector('english', description));
CREATE INDEX IF NOT EXISTS idx_food_items_donation  ON food_items (donation_id);
-- BRIN: status_history is append-only and time-ordered, BRIN is tiny here
CREATE INDEX IF NOT EXISTS idx_history_changed_brin ON status_history USING BRIN (changed_at);

-- 1.6 New table: transactional outbox for the Qdrant index.
-- Qdrant holds only donation IDs + embeddings; PostgreSQL stays the source of
-- truth. Triggers queue UPSERT/DELETE work here inside the same transaction.
-- No foreign key on purpose: a DELETE instruction must outlive the deleted row.
CREATE TABLE vector_sync_outbox (
    outbox_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    donation_id  UUID        NOT NULL,
    op           VARCHAR(6)  NOT NULL CHECK (op IN ('UPSERT', 'DELETE')),
    enqueued_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    processed_at TIMESTAMPTZ
);
CREATE INDEX idx_outbox_pending ON vector_sync_outbox (enqueued_at) WHERE processed_at IS NULL;

\d donations


/* ======================================================================
   SECTION 2: PART B, DDL CHANGES
   Tables: requirements, allocations, pickups
   ====================================================================== */
\echo '==================== SECTION 2: PART B DDL CHANGES ===================='

-- 2.1 New column: which recipient user accepted the allocation
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS allocated_by UUID;
ALTER TABLE allocations DROP CONSTRAINT IF EXISTS fk_allocations_user;
ALTER TABLE allocations ADD  CONSTRAINT fk_allocations_user
    FOREIGN KEY (allocated_by) REFERENCES users(user_id)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 2.2 NOT NULL tightening
ALTER TABLE requirements ALTER COLUMN active     SET NOT NULL,
                         ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE allocations  ALTER COLUMN status     SET NOT NULL,
                         ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE pickups      ALTER COLUMN status     SET NOT NULL,
                         ALTER COLUMN created_at SET NOT NULL;

-- 2.3 One ACTIVE allocation per donation.
-- Review 1 had UNIQUE (donation_id), which also counted cancelled allocations:
-- after a missed pickup the food could never be re-allocated. A partial unique
-- index enforces the real rule.
ALTER TABLE allocations DROP CONSTRAINT IF EXISTS allocations_donation_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_allocations_one_active
    ON allocations (donation_id) WHERE status <> 'cancelled';

-- 2.4 CHECK constraints
-- Pickups gain a 'cancelled' state (for when the allocation itself is cancelled)
ALTER TABLE pickups DROP CONSTRAINT IF EXISTS pickups_status_check;
ALTER TABLE pickups ADD  CONSTRAINT pickups_status_check
    CHECK (status IN ('pending', 'scheduled', 'completed', 'missed', 'cancelled'));
ALTER TABLE pickups DROP CONSTRAINT IF EXISTS chk_pickup_completed_ts;
ALTER TABLE pickups ADD  CONSTRAINT chk_pickup_completed_ts
    CHECK ((status = 'completed') = (picked_up_at IS NOT NULL));
ALTER TABLE pickups DROP CONSTRAINT IF EXISTS chk_pickup_scheduled_ts;
ALTER TABLE pickups ADD  CONSTRAINT chk_pickup_scheduled_ts
    CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL);

ALTER TABLE requirements DROP CONSTRAINT IF EXISTS chk_requirement_dietary;
ALTER TABLE requirements ADD  CONSTRAINT chk_requirement_dietary
    CHECK (dietary_constraints <@ ARRAY['vegetarian', 'vegan', 'jain', 'halal', 'eggless',
                                        'nut_free', 'gluten_free', 'dairy_free']::TEXT[]);

-- 2.5 Foreign keys
ALTER TABLE requirements DROP CONSTRAINT IF EXISTS requirements_org_id_fkey;
ALTER TABLE requirements DROP CONSTRAINT IF EXISTS fk_requirements_org;
ALTER TABLE requirements ADD  CONSTRAINT fk_requirements_org
    FOREIGN KEY (org_id) REFERENCES organizations(org_id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Allocation history must never disappear because a parent row was deleted
ALTER TABLE allocations DROP CONSTRAINT IF EXISTS allocations_donation_id_fkey;
ALTER TABLE allocations DROP CONSTRAINT IF EXISTS fk_allocations_donation;
ALTER TABLE allocations ADD  CONSTRAINT fk_allocations_donation
    FOREIGN KEY (donation_id) REFERENCES donations(donation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE allocations DROP CONSTRAINT IF EXISTS allocations_requirement_id_fkey;
ALTER TABLE allocations DROP CONSTRAINT IF EXISTS fk_allocations_requirement;
ALTER TABLE allocations ADD  CONSTRAINT fk_allocations_requirement
    FOREIGN KEY (requirement_id) REFERENCES requirements(requirement_id)
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE allocations DROP CONSTRAINT IF EXISTS allocations_recipient_org_id_fkey;
ALTER TABLE allocations DROP CONSTRAINT IF EXISTS fk_allocations_recipient;
ALTER TABLE allocations ADD  CONSTRAINT fk_allocations_recipient
    FOREIGN KEY (recipient_org_id) REFERENCES organizations(org_id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- A pickup is part of its allocation
ALTER TABLE pickups DROP CONSTRAINT IF EXISTS pickups_allocation_id_fkey;
ALTER TABLE pickups DROP CONSTRAINT IF EXISTS fk_pickups_allocation;
ALTER TABLE pickups ADD  CONSTRAINT fk_pickups_allocation
    FOREIGN KEY (allocation_id) REFERENCES allocations(allocation_id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 2.6 Indexes  (Review 1 already has idx_requirements_active)
CREATE INDEX IF NOT EXISTS idx_requirements_org          ON requirements (org_id);
-- GIN: "which requirements can this donation satisfy" (dietary_constraints <@ tags)
CREATE INDEX IF NOT EXISTS idx_requirements_dietary_gin  ON requirements USING GIN (dietary_constraints);
CREATE INDEX IF NOT EXISTS idx_allocations_requirement   ON allocations (requirement_id);
CREATE INDEX IF NOT EXISTS idx_allocations_recipient     ON allocations (recipient_org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_allocations_allocated_by  ON allocations (allocated_by);
-- Partial: the pickup board only shows open pickups
CREATE INDEX IF NOT EXISTS idx_pickups_open              ON pickups (scheduled_at)
    WHERE status IN ('pending', 'scheduled');

\d allocations


/* ======================================================================
   SECTION 3: PART A, INSERTS
   Order: organizations, users, donations, food_items, status_history,
          vector_sync_outbox
   IDs use readable fixed UUIDs (10..=org, 20..=user, 30..=donation,
   40..=food item, 50..=requirement, 60..=allocation, 70..=pickup).
   donations.quantity is the estimated number of servings; food_items holds
   the actual line items with their own units.
   Live listings use times relative to now() so the demos always work;
   finished listings use fixed September dates.
   ====================================================================== */
\echo '==================== SECTION 3: PART A INSERTS ===================='

INSERT INTO organizations (org_id, name, address, lat, lng) VALUES
('10000000-0000-0000-0000-000000000001', 'Hotel Annapoorna',             '4th Block, Jayanagar, Bengaluru',           12.9250, 77.5938),
('10000000-0000-0000-0000-000000000002', 'Green Leaf Caterers',          '5th Block, Koramangala, Bengaluru',         12.9352, 77.6245),
('10000000-0000-0000-0000-000000000003', 'Akshaya Shelter Home',         'Banashankari 2nd Stage, Bengaluru',         12.9255, 77.5468),
('10000000-0000-0000-0000-000000000004', 'Hope Foundation',              '100 Feet Road, Indiranagar, Bengaluru',     12.9784, 77.6408),
('10000000-0000-0000-0000-000000000005', 'Community Kitchen Collective', '8th Cross, Malleshwaram, Bengaluru',        13.0035, 77.5709),
('10000000-0000-0000-0000-000000000006', 'FoodLink Operations',          'PES University, Ring Road Campus',          12.9346, 77.5345),
('10000000-0000-0000-0000-000000000007', 'Udupi Grand Restaurant',       'Gandhi Bazaar, Basavanagudi, Bengaluru',    12.9417, 77.5755),
('10000000-0000-0000-0000-000000000008', 'FreshMart Supermarket',        '27th Main, HSR Layout, Bengaluru',          12.9116, 77.6389),
('10000000-0000-0000-0000-000000000009', 'Sneha Old Age Home',           '2nd Block, Rajajinagar, Bengaluru',         12.9910, 77.5520),
('10000000-0000-0000-0000-000000000010', 'Little Stars Orphanage',       '16th Main, BTM Layout, Bengaluru',          12.9166, 77.6101),
('10000000-0000-0000-0000-000000000011', 'TechCorp Campus Cafeteria',    'ITPL Main Road, Whitefield, Bengaluru',     12.9698, 77.7500),
('10000000-0000-0000-0000-000000000012', 'Annadana Seva Trust',          'Hope Farm Junction, Whitefield, Bengaluru', 12.9750, 77.7400);

-- Org 5 is dual-role (one donor user, one recipient user).
-- Demo-only hashes; the application stores bcrypt hashes.
INSERT INTO users (user_id, org_id, name, email, password_hash, role) VALUES
('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Ravi Kumar',     'ravi@annapoorna.in',        encode(sha256('Ravi@123'::bytea),    'hex'), 'donor'),
('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Meera Nair',     'meera@greenleaf.in',        encode(sha256('Meera@123'::bytea),   'hex'), 'donor'),
('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'Anita Rao',      'anita@akshaya.org',         encode(sha256('Anita@123'::bytea),   'hex'), 'recipient'),
('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'Joseph DSouza',  'joseph@hopefoundation.org', encode(sha256('Joseph@123'::bytea),  'hex'), 'recipient'),
('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'Farah Khan',     'farah@ckc.org',             encode(sha256('Farah@123'::bytea),   'hex'), 'donor'),
('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000005', 'Kiran Shetty',   'kiran@ckc.org',             encode(sha256('Kiran@123'::bytea),   'hex'), 'recipient'),
('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000006', 'FoodLink Admin', 'admin@foodlink.app',        encode(sha256('Admin@123'::bytea),   'hex'), 'admin'),
('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000007', 'Suresh Bhat',    'suresh@udupigrand.in',      encode(sha256('Suresh@123'::bytea),  'hex'), 'donor'),
('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000008', 'Lakshmi Iyer',   'lakshmi@freshmart.in',      encode(sha256('Lakshmi@123'::bytea), 'hex'), 'donor'),
('20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000009', 'Thomas George',  'thomas@snehahome.org',      encode(sha256('Thomas@123'::bytea),  'hex'), 'recipient'),
('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000010', 'Pooja Kamath',   'pooja@littlestars.org',     encode(sha256('Pooja@123'::bytea),   'hex'), 'recipient'),
('20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000011', 'Arvind Menon',   'arvind@techcorp.in',        encode(sha256('Arvind@123'::bytea),  'hex'), 'donor'),
('20000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000012', 'Deepa Reddy',    'deepa@annadana.org',        encode(sha256('Deepa@123'::bytea),   'hex'), 'recipient'),
('20000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000006', 'Naveen Gowda',   'naveen@foodlink.app',       encode(sha256('Naveen@123'::bytea),  'hex'), 'admin');

INSERT INTO donations (donation_id, org_id, created_by, description, dietary_tags, quantity,
                       prepared_at, expires_at, pickup_lat, pickup_lng, status, created_at, updated_at) VALUES
-- live listings
('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
 'Vegetable pulao from the lunch buffet, packed in foil trays', '{vegetarian,eggless}', 40,
 now() - interval '3 hours', now() + interval '6 hours', 12.9250, 77.5938, 'AVAILABLE', now() - interval '2 hours', now() - interval '115 minutes'),
('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
 'Whole wheat and white bread loaves baked this morning', '{vegetarian,eggless}', 25,
 now() - interval '6 hours', now() + interval '24 hours', 12.9352, 77.6245, 'ALLOCATED', now() - interval '5 hours', now() - interval '2 hours'),
('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
 'Fresh fruit crates, bananas and apples, slightly bruised but good to eat', '{vegetarian,vegan,jain,gluten_free,nut_free}', 15,
 now() - interval '2 hours', now() + interval '48 hours', 12.9352, 77.6245, 'AVAILABLE', now() - interval '1 hour', now() - interval '55 minutes'),
('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005',
 'Dal and rice meal packs with lemon pickle', '{vegetarian,eggless,nut_free}', 60,
 now() - interval '2 hours', now() + interval '5 hours', 13.0035, 77.5709, 'ALLOCATED', now() - interval '90 minutes', now() - interval '45 minutes'),
('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
 'Curd rice packets, kept refrigerated', '{vegetarian,eggless,nut_free,gluten_free}', 10,
 now() - interval '1 hour', now() + interval '8 hours', 12.9250, 77.5938, 'AVAILABLE', now() - interval '30 minutes', now() - interval '28 minutes'),
('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000009',
 'Toned milk pouches, 500 ml each, cold chain maintained', '{vegetarian,eggless,nut_free,gluten_free}', 20,
 now() - interval '12 hours', now() + interval '30 hours', 12.9116, 77.6389, 'AVAILABLE', now() - interval '2 hours', now() - interval '118 minutes'),
('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012',
 'Grilled vegetable sandwiches left over from a corporate event', '{vegetarian,eggless}', 50,
 now() - interval '3 hours', now() + interval '4 hours', 12.9698, 77.7500, 'PICKED_UP', now() - interval '150 minutes', now() - interval '30 minutes'),
('30000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000008',
 'Breakfast idlis with coconut chutney', '{vegetarian,vegan,eggless,gluten_free}', 30,
 now() - interval '2 hours', now() + interval '3 hours', 12.9417, 77.5755, 'AVAILABLE', now() - interval '2 hours', now() - interval '80 minutes'),
('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000008',
 'Paneer butter masala, listing still being prepared', '{vegetarian}', 25,
 now() - interval '1 hour', now() + interval '7 hours', 12.9417, 77.5755, 'DRAFT', now() - interval '20 minutes', now() - interval '20 minutes'),
('30000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005',
 'Sambar rice from the community kitchen', '{vegetarian,eggless}', 20,
 now() - interval '1 hour', now() + interval '6 hours', 13.0035, 77.5709, 'AVAILABLE', now() - interval '40 minutes', now() - interval '38 minutes'),
-- finished listings
('30000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000009',
 'Carrots, beans and cabbage nearing shelf date', '{vegetarian,vegan,gluten_free,nut_free}', 40,
 '2026-09-10 07:00+05:30', '2026-09-12 20:00+05:30', 12.9116, 77.6389, 'COMPLETED', '2026-09-10 08:00+05:30', '2026-09-10 14:00+05:30'),
('30000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
 'Wedding reception surplus: rice, sambar, two curries and payasam', '{vegetarian}', 120,
 '2026-09-14 21:00+05:30', '2026-09-15 06:00+05:30', 12.9250, 77.5938, 'COMPLETED', '2026-09-14 21:30+05:30', '2026-09-15 02:00+05:30'),
('30000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012',
 'Sealed packets of butter cookies from cafeteria stock', '{vegetarian}', 80,
 '2026-09-20 14:00+05:30', '2026-09-27 15:00+05:30', 12.9698, 77.7500, 'EXPIRED', '2026-09-20 15:00+05:30', '2026-09-27 15:00+05:30'),
('30000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000008',
 'Chicken biryani surplus from a catering order', '{halal}', 35,
 '2026-09-25 12:00+05:30', '2026-09-25 21:00+05:30', 12.9417, 77.5755, 'CANCELLED', '2026-09-25 13:00+05:30', '2026-09-25 15:00+05:30'),
('30000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
 'Vegetable biryani and raita from a corporate lunch', '{vegetarian}', 45,
 '2026-09-18 12:00+05:30', '2026-09-18 22:00+05:30', 12.9352, 77.6245, 'COMPLETED', '2026-09-18 12:30+05:30', '2026-09-18 17:00+05:30'),
('30000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012',
 'Assorted fruit juices in sealed tetra packs', '{vegetarian,vegan,eggless,gluten_free,nut_free}', 30,
 '2026-09-22 10:00+05:30', '2026-09-29 10:00+05:30', 12.9698, 77.7500, 'COMPLETED', '2026-09-22 10:30+05:30', '2026-09-22 18:00+05:30');

INSERT INTO food_items (food_item_id, donation_id, name, quantity, unit) VALUES
('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Vegetable pulao',         40, 'plates'),
('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Whole wheat bread',       15, 'loaves'),
('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 'White bread',             10, 'loaves'),
('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000003', 'Bananas',                 10, 'kg'),
('40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000003', 'Apples',                   5, 'kg'),
('40000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000004', 'Dal and rice meal pack',  60, 'packs'),
('40000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000005', 'Curd rice',               10, 'packets'),
('40000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000006', 'Toned milk 500 ml pouch', 40, 'pouches'),
('40000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000007', 'Veg sandwich',            50, 'pieces'),
('40000000-0000-0000-0000-000000000010', '30000000-0000-0000-0000-000000000008', 'Idli',                    90, 'pieces'),
('40000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000008', 'Coconut chutney',          3, 'litres'),
('40000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000009', 'Paneer butter masala',    25, 'portions'),
('40000000-0000-0000-0000-000000000013', '30000000-0000-0000-0000-000000000010', 'Carrots',                 15, 'kg'),
('40000000-0000-0000-0000-000000000014', '30000000-0000-0000-0000-000000000010', 'Beans',                   10, 'kg'),
('40000000-0000-0000-0000-000000000015', '30000000-0000-0000-0000-000000000010', 'Cabbage',                 15, 'kg'),
('40000000-0000-0000-0000-000000000016', '30000000-0000-0000-0000-000000000011', 'Rice',                    20, 'kg'),
('40000000-0000-0000-0000-000000000017', '30000000-0000-0000-0000-000000000011', 'Sambar',                  15, 'litres'),
('40000000-0000-0000-0000-000000000018', '30000000-0000-0000-0000-000000000011', 'Payasam',                 10, 'litres'),
('40000000-0000-0000-0000-000000000019', '30000000-0000-0000-0000-000000000012', 'Butter cookies',          80, 'packets'),
('40000000-0000-0000-0000-000000000020', '30000000-0000-0000-0000-000000000013', 'Chicken biryani',         35, 'portions'),
('40000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000014', 'Vegetable biryani',       45, 'portions'),
('40000000-0000-0000-0000-000000000022', '30000000-0000-0000-0000-000000000014', 'Raita',                    5, 'litres'),
('40000000-0000-0000-0000-000000000023', '30000000-0000-0000-0000-000000000015', 'Mango juice',             20, 'packs'),
('40000000-0000-0000-0000-000000000024', '30000000-0000-0000-0000-000000000015', 'Orange juice',            10, 'packs'),
('40000000-0000-0000-0000-000000000025', '30000000-0000-0000-0000-000000000016', 'Sambar rice',             20, 'portions');

-- Donation lifecycle history (allocation history is added in Section 4)
INSERT INTO status_history (entity_type, donation_id, old_status, new_status, changed_by, changed_at)
SELECT 'donation', ('30000000-0000-0000-0000-0000000000' || lpad(d::TEXT, 2, '0'))::UUID,
       o, n, ('20000000-0000-0000-0000-0000000000' || lpad(u::TEXT, 2, '0'))::UUID, t
  FROM (VALUES
    (1,  NULL,        'DRAFT',     1,  now() - interval '2 hours'),
    (1,  'DRAFT',     'AVAILABLE', 1,  now() - interval '115 minutes'),
    (2,  NULL,        'DRAFT',     2,  now() - interval '5 hours'),
    (2,  'DRAFT',     'AVAILABLE', 2,  now() - interval '295 minutes'),
    (2,  'AVAILABLE', 'ALLOCATED', 6,  now() - interval '2 hours'),
    (3,  NULL,        'DRAFT',     2,  now() - interval '1 hour'),
    (3,  'DRAFT',     'AVAILABLE', 2,  now() - interval '55 minutes'),
    (4,  NULL,        'DRAFT',     5,  now() - interval '90 minutes'),
    (4,  'DRAFT',     'AVAILABLE', 5,  now() - interval '85 minutes'),
    (4,  'AVAILABLE', 'ALLOCATED', 3,  now() - interval '45 minutes'),
    (5,  NULL,        'DRAFT',     1,  now() - interval '30 minutes'),
    (5,  'DRAFT',     'AVAILABLE', 1,  now() - interval '28 minutes'),
    (6,  NULL,        'DRAFT',     9,  now() - interval '2 hours'),
    (6,  'DRAFT',     'AVAILABLE', 9,  now() - interval '118 minutes'),
    (7,  NULL,        'DRAFT',     12, now() - interval '150 minutes'),
    (7,  'DRAFT',     'AVAILABLE', 12, now() - interval '145 minutes'),
    (7,  'AVAILABLE', 'ALLOCATED', 13, now() - interval '2 hours'),
    (7,  'ALLOCATED', 'PICKED_UP', 13, now() - interval '30 minutes'),
    (8,  NULL,        'DRAFT',     8,  now() - interval '2 hours'),
    (8,  'DRAFT',     'AVAILABLE', 8,  now() - interval '115 minutes'),
    (8,  'AVAILABLE', 'ALLOCATED', 4,  now() - interval '100 minutes'),
    (8,  'ALLOCATED', 'AVAILABLE', 4,  now() - interval '80 minutes'),
    (9,  NULL,        'DRAFT',     8,  now() - interval '20 minutes'),
    (16, NULL,        'DRAFT',     5,  now() - interval '40 minutes'),
    (16, 'DRAFT',     'AVAILABLE', 5,  now() - interval '38 minutes'),
    (10, NULL,        'DRAFT',     9,  '2026-09-10 08:00+05:30'::TIMESTAMPTZ),
    (10, 'DRAFT',     'AVAILABLE', 9,  '2026-09-10 08:05+05:30'),
    (10, 'AVAILABLE', 'ALLOCATED', 10, '2026-09-10 09:00+05:30'),
    (10, 'ALLOCATED', 'PICKED_UP', 10, '2026-09-10 12:30+05:30'),
    (10, 'PICKED_UP', 'COMPLETED', 10, '2026-09-10 14:00+05:30'),
    (11, NULL,        'DRAFT',     1,  '2026-09-14 21:30+05:30'),
    (11, 'DRAFT',     'AVAILABLE', 1,  '2026-09-14 21:35+05:30'),
    (11, 'AVAILABLE', 'ALLOCATED', 13, '2026-09-14 23:00+05:30'),
    (11, 'ALLOCATED', 'PICKED_UP', 13, '2026-09-15 00:30+05:30'),
    (11, 'PICKED_UP', 'COMPLETED', 13, '2026-09-15 02:00+05:30'),
    (12, NULL,        'DRAFT',     12, '2026-09-20 15:00+05:30'),
    (12, 'DRAFT',     'AVAILABLE', 12, '2026-09-20 15:05+05:30'),
    (12, 'AVAILABLE', 'EXPIRED',   NULL, '2026-09-27 15:00+05:30'),
    (13, NULL,        'DRAFT',     8,  '2026-09-25 13:00+05:30'),
    (13, 'DRAFT',     'AVAILABLE', 8,  '2026-09-25 13:05+05:30'),
    (13, 'AVAILABLE', 'ALLOCATED', 13, '2026-09-25 14:00+05:30'),
    (13, 'ALLOCATED', 'CANCELLED', 8,  '2026-09-25 15:00+05:30'),
    (14, NULL,        'DRAFT',     2,  '2026-09-18 12:30+05:30'),
    (14, 'DRAFT',     'AVAILABLE', 2,  '2026-09-18 12:35+05:30'),
    (14, 'AVAILABLE', 'ALLOCATED', 3,  '2026-09-18 12:45+05:30'),
    (14, 'ALLOCATED', 'AVAILABLE', 3,  '2026-09-18 12:55+05:30'),
    (14, 'AVAILABLE', 'ALLOCATED', 4,  '2026-09-18 13:00+05:30'),
    (14, 'ALLOCATED', 'PICKED_UP', 4,  '2026-09-18 15:20+05:30'),
    (14, 'PICKED_UP', 'COMPLETED', 4,  '2026-09-18 17:00+05:30'),
    (15, NULL,        'DRAFT',     12, '2026-09-22 10:30+05:30'),
    (15, 'DRAFT',     'AVAILABLE', 12, '2026-09-22 10:35+05:30'),
    (15, 'AVAILABLE', 'ALLOCATED', 11, '2026-09-22 11:00+05:30'),
    (15, 'ALLOCATED', 'PICKED_UP', 11, '2026-09-22 16:10+05:30'),
    (15, 'PICKED_UP', 'COMPLETED', 11, '2026-09-22 18:00+05:30')
  ) AS h(d, o, n, u, t);

-- Qdrant sync work: UPSERT on publish, DELETE once a listing is finished
INSERT INTO vector_sync_outbox (donation_id, op, enqueued_at, processed_at)
SELECT donation_id, 'UPSERT', created_at + interval '1 minute',
       CASE WHEN donation_id IN ('30000000-0000-0000-0000-000000000003',
                                 '30000000-0000-0000-0000-000000000005',
                                 '30000000-0000-0000-0000-000000000016')
            THEN NULL ELSE created_at + interval '1 minute 2 seconds' END
  FROM donations WHERE status <> 'DRAFT'
UNION ALL
SELECT donation_id, 'DELETE', updated_at, updated_at + interval '2 seconds'
  FROM donations WHERE status IN ('COMPLETED', 'EXPIRED', 'CANCELLED')
ORDER BY 3;

SELECT org_id, name, address, lat, lng FROM organizations;
SELECT user_id, org_id, name, email, role, is_active FROM users;
SELECT donation_id, org_id, description, dietary_tags, quantity AS servings, status, expires_at FROM donations;
SELECT donation_id, name, quantity, unit FROM food_items;
SELECT entity_type, donation_id, old_status, new_status, changed_by, changed_at FROM status_history;
SELECT * FROM vector_sync_outbox;


/* ======================================================================
   SECTION 4: PART B, INSERTS
   (needs organizations, users and donations from Part A)
   ====================================================================== */
\echo '==================== SECTION 4: PART B INSERTS ===================='

-- max_capacity is the number of servings the organization can accept at once
INSERT INTO requirements (requirement_id, org_id, created_by, description, dietary_constraints,
                          max_capacity, active, created_at) VALUES
('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003',
 'Dinner for 60 shelter residents',              '{vegetarian}',          60,  TRUE,  '2026-09-01 10:00+05:30'),
('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003',
 'Breakfast for residents, no onion or garlic',  '{vegetarian,jain}',     40,  TRUE,  '2026-09-01 10:05+05:30'),
('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004',
 'Lunch for the street children programme',      '{vegetarian}',          50,  TRUE,  '2026-09-02 09:00+05:30'),
('50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004',
 'Fresh produce for the community kitchen',      '{}',                    30,  TRUE,  '2026-09-02 09:10+05:30'),
('50000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006',
 'Bread and staples for weekend meals',          '{eggless}',             30,  TRUE,  '2026-09-03 11:00+05:30'),
('50000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000010',
 'Soft food for elderly residents',              '{vegetarian,nut_free}', 40,  TRUE,  '2026-09-03 12:00+05:30'),
('50000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000011',
 'Evening snacks for 30 children',               '{vegetarian,eggless}',  35,  TRUE,  '2026-09-04 16:00+05:30'),
('50000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000013',
 'Meals for daily-wage workers',                 '{}',                    150, TRUE,  '2026-09-04 18:00+05:30'),
('50000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000013',
 'Halal meals for the night shelter',            '{halal}',               40,  TRUE,  '2026-09-05 19:00+05:30'),
('50000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000011',
 'Milk for children',                            '{vegetarian}',          25,  TRUE,  '2026-09-06 08:00+05:30'),
('50000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000010',
 'Festival lunch for residents',                 '{vegetarian}',          100, FALSE, '2026-09-01 08:00+05:30');

-- One whole donation per allocation; quantity equals the donation's servings
INSERT INTO allocations (allocation_id, donation_id, requirement_id, recipient_org_id, allocated_by,
                         quantity, status, created_at) VALUES
('60000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000005',
 '10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006', 25,  'confirmed', now() - interval '2 hours'),
('60000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 60,  'confirmed', now() - interval '45 minutes'),
('60000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-000000000008',
 '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000013', 50,  'confirmed', now() - interval '2 hours'),
('60000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000008', '50000000-0000-0000-0000-000000000003',
 '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 30,  'cancelled', now() - interval '100 minutes'),
('60000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000010', '50000000-0000-0000-0000-000000000006',
 '10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000010', 40,  'completed', '2026-09-10 09:00+05:30'),
('60000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000008',
 '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000013', 120, 'completed', '2026-09-14 23:00+05:30'),
('60000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000014', '50000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 45,  'cancelled', '2026-09-18 12:45+05:30'),
('60000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000013', '50000000-0000-0000-0000-000000000009',
 '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000013', 35,  'cancelled', '2026-09-25 14:00+05:30'),
('60000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000014', '50000000-0000-0000-0000-000000000003',
 '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 45,  'completed', '2026-09-18 13:00+05:30'),
('60000000-0000-0000-0000-000000000010', '30000000-0000-0000-0000-000000000015', '50000000-0000-0000-0000-000000000007',
 '10000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000011', 30,  'completed', '2026-09-22 11:00+05:30');

INSERT INTO pickups (pickup_id, allocation_id, scheduled_at, picked_up_at, status, created_at) VALUES
('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', now() + interval '1 hour', NULL,                         'scheduled', now() - interval '2 hours'),
('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', NULL,                     NULL,                         'pending',   now() - interval '45 minutes'),
('70000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003', now() - interval '1 hour', now() - interval '30 minutes', 'completed', now() - interval '2 hours'),
('70000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000004', now() - interval '90 minutes', NULL,                     'missed',    now() - interval '100 minutes'),
('70000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000005', '2026-09-10 12:00+05:30', '2026-09-10 12:30+05:30',     'completed', '2026-09-10 09:00+05:30'),
('70000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-000000000006', '2026-09-15 00:00+05:30', '2026-09-15 00:30+05:30',     'completed', '2026-09-14 23:00+05:30'),
('70000000-0000-0000-0000-000000000007', '60000000-0000-0000-0000-000000000007', NULL,                     NULL,                         'cancelled', '2026-09-18 12:45+05:30'),
('70000000-0000-0000-0000-000000000008', '60000000-0000-0000-0000-000000000008', NULL,                     NULL,                         'cancelled', '2026-09-25 14:00+05:30'),
('70000000-0000-0000-0000-000000000009', '60000000-0000-0000-0000-000000000009', '2026-09-18 15:00+05:30', '2026-09-18 15:20+05:30',     'completed', '2026-09-18 13:00+05:30'),
('70000000-0000-0000-0000-000000000010', '60000000-0000-0000-0000-000000000010', '2026-09-22 16:00+05:30', '2026-09-22 16:10+05:30',     'completed', '2026-09-22 11:00+05:30');

-- Allocation lifecycle history
INSERT INTO status_history (entity_type, allocation_id, donation_id, old_status, new_status, changed_by, changed_at)
SELECT 'allocation', a.allocation_id, a.donation_id, h.o, h.n, a.allocated_by, h.t
  FROM (VALUES
    (1,  NULL,        'confirmed', now() - interval '2 hours'),
    (2,  NULL,        'confirmed', now() - interval '45 minutes'),
    (3,  NULL,        'confirmed', now() - interval '2 hours'),
    (4,  NULL,        'confirmed', now() - interval '100 minutes'),
    (4,  'confirmed', 'cancelled', now() - interval '80 minutes'),
    (5,  NULL,        'confirmed', '2026-09-10 09:00+05:30'::TIMESTAMPTZ),
    (5,  'confirmed', 'completed', '2026-09-10 14:00+05:30'),
    (6,  NULL,        'confirmed', '2026-09-14 23:00+05:30'),
    (6,  'confirmed', 'completed', '2026-09-15 02:00+05:30'),
    (7,  NULL,        'confirmed', '2026-09-18 12:45+05:30'),
    (7,  'confirmed', 'cancelled', '2026-09-18 12:55+05:30'),
    (8,  NULL,        'confirmed', '2026-09-25 14:00+05:30'),
    (8,  'confirmed', 'cancelled', '2026-09-25 15:00+05:30'),
    (9,  NULL,        'confirmed', '2026-09-18 13:00+05:30'),
    (9,  'confirmed', 'completed', '2026-09-18 17:00+05:30'),
    (10, NULL,        'confirmed', '2026-09-22 11:00+05:30'),
    (10, 'confirmed', 'completed', '2026-09-22 18:00+05:30')
  ) AS h(n_alloc, o, n, t)
  JOIN allocations a
    ON a.allocation_id = ('60000000-0000-0000-0000-0000000000' || lpad(h.n_alloc::TEXT, 2, '0'))::UUID;

SELECT requirement_id, org_id, description, dietary_constraints, max_capacity, active FROM requirements;
SELECT allocation_id, donation_id, requirement_id, recipient_org_id, quantity, status, created_at FROM allocations;
SELECT pickup_id, allocation_id, status, scheduled_at, picked_up_at FROM pickups;

-- Consistency checks on the seed snapshot (each should return 0 rows)
-- (a) every active allocation satisfies its requirement's diet and capacity
SELECT a.allocation_id FROM allocations a
  JOIN donations d    ON d.donation_id    = a.donation_id
  JOIN requirements r ON r.requirement_id = a.requirement_id
 WHERE a.status <> 'cancelled'
   AND (NOT d.dietary_tags @> r.dietary_constraints OR d.quantity > r.max_capacity
        OR a.recipient_org_id <> r.org_id OR d.org_id = r.org_id);
-- (b) donation status agrees with its active allocation and pickup
SELECT d.donation_id, d.status, a.status AS allocation_status, p.status AS pickup_status
  FROM donations d
  JOIN allocations a ON a.donation_id = d.donation_id AND a.status <> 'cancelled'
  JOIN pickups p     ON p.allocation_id = a.allocation_id
 WHERE NOT ((d.status = 'ALLOCATED' AND a.status = 'confirmed' AND p.status IN ('pending', 'scheduled'))
         OR (d.status = 'PICKED_UP' AND a.status = 'confirmed' AND p.status = 'completed')
         OR (d.status = 'COMPLETED' AND a.status = 'completed' AND p.status = 'completed'));


/* ======================================================================
   SECTION 5: UPDATE / DELETE EXAMPLES
   ====================================================================== */
\echo '==================== SECTION 5: UPDATE / DELETE ===================='

-- ---------- Part A ----------
-- Correct an organization's address
UPDATE organizations SET address = '2nd Block, Rajajinagar, Bengaluru 560010'
 WHERE org_id = '10000000-0000-0000-0000-000000000009';
SELECT name, address FROM organizations WHERE org_id = '10000000-0000-0000-0000-000000000009';

-- Deactivate a user (soft delete keeps every reference intact)
UPDATE users SET is_active = FALSE WHERE email = 'naveen@foodlink.app';
SELECT name, role, is_active FROM users WHERE email = 'naveen@foodlink.app';

-- ON DELETE SET NULL and ON DELETE CASCADE in one walk-through:
-- a temporary organization, donor, draft donation with two items and a history row.
INSERT INTO organizations (org_id, name, address, lat, lng)
VALUES ('10000000-0000-0000-0000-000000000099', 'Temporary Test Org', 'Test address', 12.93, 77.58);
INSERT INTO users (user_id, org_id, name, email, password_hash, role)
VALUES ('20000000-0000-0000-0000-000000000099', '10000000-0000-0000-0000-000000000099',
        'Temp Donor', 'temp.donor@test.org', encode(sha256('Temp@123'::bytea), 'hex'), 'donor');
INSERT INTO donations (donation_id, org_id, created_by, description, quantity, prepared_at, expires_at,
                       pickup_lat, pickup_lng, status)
VALUES ('30000000-0000-0000-0000-000000000099', '10000000-0000-0000-0000-000000000099',
        '20000000-0000-0000-0000-000000000099', 'Temporary test listing', 5,
        now(), now() + interval '1 day', 12.93, 77.58, 'DRAFT');
INSERT INTO food_items (donation_id, name, quantity, unit) VALUES
('30000000-0000-0000-0000-000000000099', 'Test item A', 3, 'units'),
('30000000-0000-0000-0000-000000000099', 'Test item B', 2, 'units');
INSERT INTO status_history (entity_type, donation_id, old_status, new_status, changed_by)
VALUES ('donation', '30000000-0000-0000-0000-000000000099', NULL, 'DRAFT', '20000000-0000-0000-0000-000000000099');

-- (a) delete the user: donation.created_by and history.changed_by become NULL
DELETE FROM users WHERE user_id = '20000000-0000-0000-0000-000000000099';
SELECT d.description, d.created_by, h.changed_by
  FROM donations d JOIN status_history h ON h.donation_id = d.donation_id
 WHERE d.donation_id = '30000000-0000-0000-0000-000000000099';

-- (b) delete the donation: its food items and history rows cascade away
SELECT (SELECT count(*) FROM food_items     WHERE donation_id = '30000000-0000-0000-0000-000000000099') AS items_before,
       (SELECT count(*) FROM status_history WHERE donation_id = '30000000-0000-0000-0000-000000000099') AS history_before;
DELETE FROM donations WHERE donation_id = '30000000-0000-0000-0000-000000000099';
SELECT (SELECT count(*) FROM food_items     WHERE donation_id = '30000000-0000-0000-0000-000000000099') AS items_after,
       (SELECT count(*) FROM status_history WHERE donation_id = '30000000-0000-0000-0000-000000000099') AS history_after;

-- (c) the organization now has nothing referencing it, so it can be deleted
DELETE FROM organizations WHERE org_id = '10000000-0000-0000-0000-000000000099';

-- ---------- Part B ----------
-- An NGO raises its capacity
UPDATE requirements SET max_capacity = 30 WHERE requirement_id = '50000000-0000-0000-0000-000000000010';
SELECT description, max_capacity FROM requirements WHERE requirement_id = '50000000-0000-0000-0000-000000000010';

-- Reschedule a pickup
UPDATE pickups SET scheduled_at = scheduled_at + interval '30 minutes'
 WHERE pickup_id = '70000000-0000-0000-0000-000000000001';
SELECT pickup_id, status, scheduled_at FROM pickups WHERE pickup_id = '70000000-0000-0000-0000-000000000001';

-- ON DELETE CASCADE: deleting an allocation removes its pickup and history rows
INSERT INTO allocations (allocation_id, donation_id, requirement_id, recipient_org_id, quantity)
VALUES ('60000000-0000-0000-0000-000000000099', '30000000-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004', 40);
INSERT INTO pickups (allocation_id) VALUES ('60000000-0000-0000-0000-000000000099');
INSERT INTO status_history (entity_type, allocation_id, old_status, new_status)
VALUES ('allocation', '60000000-0000-0000-0000-000000000099', NULL, 'confirmed');
SELECT (SELECT count(*) FROM pickups        WHERE allocation_id = '60000000-0000-0000-0000-000000000099') AS pickups_before,
       (SELECT count(*) FROM status_history WHERE allocation_id = '60000000-0000-0000-0000-000000000099') AS history_before;
DELETE FROM allocations WHERE allocation_id = '60000000-0000-0000-0000-000000000099';
SELECT (SELECT count(*) FROM pickups        WHERE allocation_id = '60000000-0000-0000-0000-000000000099') AS pickups_after,
       (SELECT count(*) FROM status_history WHERE allocation_id = '60000000-0000-0000-0000-000000000099') AS history_after;


/* ======================================================================
   SECTION 6: PART A QUERIES
   ====================================================================== */
\echo '==================== SECTION 6: PART A QUERIES ===================='

-- A.Q1 Listings per donor organization with a status breakdown (at least 2 listings)
SELECT o.name AS donor_org,
       count(*)                                         AS listings,
       sum(d.quantity)                                  AS servings_listed,
       count(*) FILTER (WHERE d.status = 'COMPLETED')   AS completed,
       count(*) FILTER (WHERE d.status = 'EXPIRED')     AS expired
  FROM donations d
  JOIN organizations o ON o.org_id = d.org_id
 GROUP BY o.org_id, o.name
HAVING count(*) >= 2
 ORDER BY servings_listed DESC;

-- A.Q2 Available listings expiring in the next 6 hours, with their line items
SELECT d.description,
       string_agg(f.name || ' (' || f.quantity || ' ' || f.unit || ')', ', ' ORDER BY f.name) AS items,
       round((extract(epoch FROM d.expires_at - now()) / 3600)::NUMERIC, 1)                AS hours_left
  FROM donations d
  JOIN food_items f ON f.donation_id = d.donation_id
 WHERE d.status = 'AVAILABLE'
   AND d.expires_at BETWEEN now() AND now() + interval '6 hours'
 GROUP BY d.donation_id
 ORDER BY d.expires_at;

-- A.Q3 Organizations that have never listed a donation
SELECT o.name
  FROM organizations o
 WHERE NOT EXISTS (SELECT 1 FROM donations d WHERE d.org_id = o.org_id)
 ORDER BY o.name;

-- A.Q4 Wastage: listings that expired without ever being allocated
SELECT o.name AS donor_org, d.description, d.quantity AS servings_wasted, d.expires_at
  FROM donations d
  JOIN organizations o ON o.org_id = d.org_id
 WHERE d.status = 'EXPIRED'
   AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.donation_id = d.donation_id);

-- A.Q5 Full status path of every listing from status_history
SELECT d.description,
       string_agg(h.new_status, ' -> ' ORDER BY h.changed_at, h.history_id) AS status_path
  FROM donations d
  JOIN status_history h ON h.donation_id = d.donation_id AND h.entity_type = 'donation'
 GROUP BY d.donation_id, d.description
 ORDER BY min(h.changed_at);

-- A.Q6 Running total of servings each donor has listed over time (window function)
SELECT o.name AS donor_org, d.created_at::DATE AS listed_on, d.quantity AS servings,
       SUM(d.quantity) OVER (PARTITION BY d.org_id ORDER BY d.created_at) AS running_servings,
       RANK()          OVER (PARTITION BY d.org_id ORDER BY d.quantity DESC) AS size_rank
  FROM donations d
  JOIN organizations o ON o.org_id = d.org_id
 ORDER BY donor_org, d.created_at;


/* ======================================================================
   SECTION 7: PART B QUERIES
   ====================================================================== */
\echo '==================== SECTION 7: PART B QUERIES ===================='

-- B.Q1 Each requirement with what it has received so far
SELECT o.name AS recipient_org, r.description, r.max_capacity,
       count(a.allocation_id) FILTER (WHERE a.status = 'completed') AS completed,
       count(a.allocation_id) FILTER (WHERE a.status = 'confirmed') AS in_progress,
       COALESCE(sum(a.quantity) FILTER (WHERE a.status = 'completed'), 0) AS servings_received
  FROM requirements r
  JOIN organizations o     ON o.org_id = r.org_id
  LEFT JOIN allocations a  ON a.requirement_id = r.requirement_id
 GROUP BY o.name, r.requirement_id, r.description, r.max_capacity
 ORDER BY servings_received DESC, recipient_org;

-- B.Q2 Average minutes from allocation to completed pickup, per recipient
SELECT o.name AS recipient_org, count(*) AS pickups,
       round(avg(extract(epoch FROM p.picked_up_at - a.created_at) / 60)::NUMERIC, 0) AS avg_minutes
  FROM pickups p
  JOIN allocations a   ON a.allocation_id = p.allocation_id
  JOIN organizations o ON o.org_id = a.recipient_org_id
 WHERE p.status = 'completed'
 GROUP BY o.name
 ORDER BY avg_minutes;

-- B.Q3 Recipients that received food from more than one donor organization
SELECT r.name AS recipient_org, count(DISTINCT d.org_id) AS distinct_donors,
       string_agg(DISTINCT dn.name, ', ') AS donors
  FROM allocations a
  JOIN donations d      ON d.donation_id = a.donation_id
  JOIN organizations r  ON r.org_id = a.recipient_org_id
  JOIN organizations dn ON dn.org_id = d.org_id
 WHERE a.status <> 'cancelled'
 GROUP BY r.name
HAVING count(DISTINCT d.org_id) > 1;

-- B.Q4 Active requirements that have never received an allocation
SELECT o.name AS recipient_org, r.description, r.dietary_constraints, r.max_capacity
  FROM requirements r
  JOIN organizations o ON o.org_id = r.org_id
 WHERE r.active
   AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.requirement_id = r.requirement_id);

-- B.Q5 For each active requirement, how many available listings fit its diet and capacity
--      (array containment: donation tags must include every required tag)
SELECT o.name AS recipient_org, r.description, r.dietary_constraints,
       count(d.donation_id) AS compatible_listings
  FROM requirements r
  JOIN organizations o ON o.org_id = r.org_id
  LEFT JOIN donations d
         ON d.status = 'AVAILABLE' AND d.expires_at > now()
        AND d.dietary_tags @> r.dietary_constraints
        AND d.quantity <= r.max_capacity
        AND d.org_id <> r.org_id
 WHERE r.active
 GROUP BY o.name, r.requirement_id, r.description, r.dietary_constraints
 ORDER BY compatible_listings DESC, recipient_org;

-- B.Q6 Pickup punctuality against the scheduled time
SELECT o.name AS recipient_org, p.scheduled_at, p.picked_up_at,
       round((extract(epoch FROM p.picked_up_at - p.scheduled_at) / 60)::NUMERIC, 0) AS minutes_late,
       CASE WHEN p.picked_up_at <= p.scheduled_at + interval '15 minutes'
            THEN 'ON TIME' ELSE 'LATE' END AS verdict
  FROM pickups p
  JOIN allocations a   ON a.allocation_id = p.allocation_id
  JOIN organizations o ON o.org_id = a.recipient_org_id
 WHERE p.status = 'completed' AND p.scheduled_at IS NOT NULL
 ORDER BY p.picked_up_at;


/* ======================================================================
   SECTION 8: VIEWS, FUNCTIONS, PROCEDURES
   ====================================================================== */
\echo '==================== SECTION 8: VIEWS, FUNCTIONS, PROCEDURES ===================='

-- ---------- Shared helpers ----------
-- The application sets these once per request:
--   SELECT set_config('app.current_org_id',  '<org uuid>',  false);
--   SELECT set_config('app.current_user_id', '<user uuid>', false);
CREATE OR REPLACE FUNCTION current_org_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_org_id', true), '')::UUID
$$;

CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID
$$;

-- Great-circle distance in km (no PostGIS dependency)
CREATE OR REPLACE FUNCTION haversine_km(lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION,
                                        lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION)
RETURNS DOUBLE PRECISION
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT 2 * 6371.0 * asin(least(1.0, sqrt(
               power(sin(radians(lat2 - lat1) / 2), 2) +
               cos(radians(lat1)) * cos(radians(lat2)) *
               power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

-- ---------- Part A: view ----------
CREATE VIEW v_available_donations AS
SELECT d.donation_id,
       o.name                                  AS donor_org,
       d.description,
       d.dietary_tags,
       d.quantity                              AS servings,
       (SELECT string_agg(f.name || ' ' || f.quantity || ' ' || f.unit, ', ' ORDER BY f.name)
          FROM food_items f WHERE f.donation_id = d.donation_id) AS items,
       d.expires_at,
       round((extract(epoch FROM d.expires_at - now()) / 3600)::NUMERIC, 1) AS hours_to_expiry
  FROM donations d
  JOIN organizations o ON o.org_id = d.org_id
 WHERE d.status = 'AVAILABLE'
   AND d.expires_at > now();

-- ---------- Part B: view ----------
-- Views run with the owner's privileges, so this one (which would bypass the
-- RLS on allocations) is granted to admin and analyst roles, never to the app.
CREATE VIEW v_allocation_details AS
SELECT a.allocation_id,
       a.status        AS allocation_status,
       d.description   AS donation,
       donor.name      AS donor_org,
       rec.name        AS recipient_org,
       r.description   AS requirement,
       a.quantity      AS servings,
       p.status        AS pickup_status,
       p.scheduled_at,
       p.picked_up_at,
       u.name          AS allocated_by
  FROM allocations a
  JOIN donations     d     ON d.donation_id    = a.donation_id
  JOIN organizations donor ON donor.org_id     = d.org_id
  JOIN organizations rec   ON rec.org_id       = a.recipient_org_id
  JOIN requirements  r     ON r.requirement_id = a.requirement_id
  LEFT JOIN pickups  p     ON p.allocation_id  = a.allocation_id
  LEFT JOIN users    u     ON u.user_id        = a.allocated_by;

-- ---------- Part A: functions ----------
-- Share of an organization's published listings that expired unused (%)
-- Used inside mv_donor_impact. PostgreSQL 17 runs functions called by
-- CREATE/REFRESH MATERIALIZED VIEW with a restricted search_path, so the table
-- is schema-qualified and the function pins its own search_path.
CREATE OR REPLACE FUNCTION donor_waste_rate(p_org_id UUID) RETURNS NUMERIC
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
    SELECT round(100.0 * count(*) FILTER (WHERE status = 'EXPIRED')
                 / NULLIF(count(*) FILTER (WHERE status <> 'DRAFT'), 0), 1)
      FROM public.donations
     WHERE org_id = p_org_id
$$;

-- Batch expiry for listings whose deadline passed with nothing writing to them.
-- Meant to be scheduled (pg_cron or an app cron job); returns rows expired.
CREATE OR REPLACE FUNCTION expire_stale_donations() RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE donations
       SET status = 'EXPIRED'
     WHERE status IN ('DRAFT', 'AVAILABLE')
       AND expires_at <= now();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- ---------- Part B: functions ----------
-- Share of an organization's finished allocations that were completed (%)
CREATE OR REPLACE FUNCTION recipient_fulfilment_rate(p_org_id UUID) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    SELECT round(100.0 * count(*) FILTER (WHERE status = 'completed')
                 / NULLIF(count(*) FILTER (WHERE status IN ('completed', 'cancelled')), 0), 1)
      FROM allocations
     WHERE recipient_org_id = p_org_id
$$;

-- Core concurrency-safe allocation. SELECT ... FOR UPDATE serializes competing
-- requests for the same donation, so two NGOs can never both be given it.
CREATE OR REPLACE FUNCTION allocate_donation(p_donation_id    UUID,
                                             p_requirement_id UUID,
                                             p_user_id        UUID)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_d             donations%ROWTYPE;
    v_r             requirements%ROWTYPE;
    v_allocation_id UUID;
BEGIN
    -- Row lock: a concurrent caller blocks here until this transaction ends
    SELECT * INTO v_d FROM donations WHERE donation_id = p_donation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Donation % does not exist', p_donation_id;
    END IF;
    IF v_d.status <> 'AVAILABLE' THEN
        RAISE EXCEPTION 'Donation % is not available (status: %)', p_donation_id, v_d.status;
    END IF;
    IF v_d.expires_at <= now() THEN
        RAISE EXCEPTION 'Donation % expired at %', p_donation_id, v_d.expires_at;
    END IF;

    SELECT * INTO v_r FROM requirements WHERE requirement_id = p_requirement_id;
    IF NOT FOUND OR NOT v_r.active THEN
        RAISE EXCEPTION 'Requirement % does not exist or is no longer active', p_requirement_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users
                    WHERE user_id = p_user_id AND org_id = v_r.org_id
                      AND role = 'recipient' AND is_active) THEN
        RAISE EXCEPTION 'User % is not an active recipient of the organization that posted requirement %',
                        p_user_id, p_requirement_id;
    END IF;

    -- Diet, capacity and self-allocation rules are enforced by trigger B.T1
    INSERT INTO allocations (donation_id, requirement_id, recipient_org_id, allocated_by, quantity)
    VALUES (p_donation_id, p_requirement_id, v_r.org_id, p_user_id, v_d.quantity)
    RETURNING allocation_id INTO v_allocation_id;

    RETURN v_allocation_id;
END;
$$;

-- Matching pipeline, stage 2. Qdrant does semantic recall and hands over ranked
-- candidate donation IDs; PostgreSQL applies the hard constraints (available,
-- unexpired, diet, capacity, not own org, within radius). Pass NULL candidates
-- for a pure database match.
CREATE OR REPLACE FUNCTION find_matching_donations(p_requirement_id UUID,
                                                   p_radius_km      DOUBLE PRECISION DEFAULT 10,
                                                   p_candidate_ids  UUID[]           DEFAULT NULL)
RETURNS TABLE (donation_id     UUID,
               description     TEXT,
               donor_org       TEXT,
               servings        NUMERIC,
               dietary_tags    TEXT[],
               distance_km     NUMERIC,
               hours_to_expiry NUMERIC)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE
    v_r    requirements%ROWTYPE;
    v_lat  DOUBLE PRECISION;
    v_lng  DOUBLE PRECISION;
    v_dlat DOUBLE PRECISION;
    v_dlng DOUBLE PRECISION;
BEGIN
    SELECT * INTO v_r FROM requirements r WHERE r.requirement_id = p_requirement_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Requirement % does not exist', p_requirement_id;
    END IF;
    SELECT o.lat, o.lng INTO v_lat, v_lng FROM organizations o WHERE o.org_id = v_r.org_id;

    -- Bounding box (cheap, index-assisted) before the exact distance
    v_dlat := p_radius_km / 111.045;
    v_dlng := p_radius_km / (111.045 * cos(radians(v_lat)));

    RETURN QUERY
    SELECT d.donation_id,
           d.description,
           o.name::TEXT,
           d.quantity,
           d.dietary_tags,
           round(haversine_km(v_lat, v_lng, d.pickup_lat, d.pickup_lng)::NUMERIC, 2),
           round((extract(epoch FROM d.expires_at - now()) / 3600)::NUMERIC, 1)
      FROM donations d
      JOIN organizations o ON o.org_id = d.org_id
     WHERE d.status = 'AVAILABLE'
       AND d.expires_at > now()
       AND d.org_id <> v_r.org_id
       AND d.dietary_tags @> v_r.dietary_constraints
       AND d.quantity <= v_r.max_capacity
       AND (p_candidate_ids IS NULL OR d.donation_id = ANY (p_candidate_ids))
       AND d.pickup_lat BETWEEN v_lat - v_dlat AND v_lat + v_dlat
       AND d.pickup_lng BETWEEN v_lng - v_dlng AND v_lng + v_dlng
       AND haversine_km(v_lat, v_lng, d.pickup_lat, d.pickup_lng) <= p_radius_km
     ORDER BY array_position(p_candidate_ids, d.donation_id) NULLS LAST,  -- keep Qdrant's rank
              d.expires_at,                                               -- else soonest expiry
              haversine_km(v_lat, v_lng, d.pickup_lat, d.pickup_lng);
END;
$$;

-- ---------- Part B: materialized view ----------
-- Donor impact leaderboard: an expensive aggregate, refreshed periodically
CREATE MATERIALIZED VIEW mv_donor_impact AS
WITH listing AS (
    SELECT org_id,
           count(*) FILTER (WHERE status <> 'DRAFT')     AS published,
           count(*) FILTER (WHERE status = 'COMPLETED')  AS completed,
           count(*) FILTER (WHERE status = 'EXPIRED')    AS expired,
           COALESCE(sum(quantity) FILTER (WHERE status = 'COMPLETED'), 0) AS servings_delivered
      FROM donations
     GROUP BY org_id
),
reach AS (
    SELECT dn.org_id, count(DISTINCT a.recipient_org_id) AS recipients_served
      FROM allocations a
      JOIN donations dn ON dn.donation_id = a.donation_id
     WHERE a.status = 'completed'
     GROUP BY dn.org_id
)
SELECT o.org_id,
       o.name                               AS donor_org,
       l.published,
       l.completed,
       l.expired,
       l.servings_delivered,
       COALESCE(r.recipients_served, 0)     AS recipients_served,
       donor_waste_rate(o.org_id)           AS waste_pct,
       DENSE_RANK() OVER (ORDER BY l.servings_delivered DESC) AS impact_rank
  FROM listing l
  JOIN organizations o ON o.org_id = l.org_id
  LEFT JOIN reach r    ON r.org_id = l.org_id;

-- A unique index is required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX idx_mv_donor_impact_org ON mv_donor_impact (org_id);

-- ---------- Part A: procedures ----------
-- Create a DRAFT listing with its line items in one call. Items are passed as
-- JSON, e.g. '[{"name":"Lemon rice","quantity":35,"unit":"packs"}]'.
-- The pickup point defaults to the organization's address.
CREATE OR REPLACE PROCEDURE create_donation(p_org_id      UUID,
                                            p_user_id     UUID,
                                            p_description TEXT,
                                            p_tags        TEXT[],
                                            p_servings    NUMERIC,
                                            p_valid_for   INTERVAL,
                                            p_items       JSONB,
                                            INOUT p_donation_id UUID DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE
    v_lat DOUBLE PRECISION;
    v_lng DOUBLE PRECISION;
BEGIN
    SELECT lat, lng INTO v_lat, v_lng FROM organizations WHERE org_id = p_org_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Organization % does not exist', p_org_id;
    END IF;

    INSERT INTO donations (org_id, created_by, description, dietary_tags, quantity,
                           prepared_at, expires_at, pickup_lat, pickup_lng)
    VALUES (p_org_id, p_user_id, p_description, COALESCE(p_tags, '{}'), p_servings,
            now(), now() + p_valid_for, v_lat, v_lng)
    RETURNING donation_id INTO p_donation_id;

    INSERT INTO food_items (donation_id, name, quantity, unit)
    SELECT p_donation_id, x.name, x.quantity, x.unit
      FROM jsonb_to_recordset(COALESCE(p_items, '[]'::JSONB))
           AS x(name TEXT, quantity NUMERIC, unit TEXT);
END;
$$;

-- DRAFT -> AVAILABLE (trigger A.T1 checks there is at least one item)
CREATE OR REPLACE PROCEDURE publish_donation(p_donation_id UUID)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE donations SET status = 'AVAILABLE' WHERE donation_id = p_donation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Donation % does not exist', p_donation_id;
    END IF;
END;
$$;

-- Withdraw a listing; trigger A.T5 cancels an active allocation and its pickup
CREATE OR REPLACE PROCEDURE cancel_donation(p_donation_id UUID)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE donations SET status = 'CANCELLED' WHERE donation_id = p_donation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Donation % does not exist', p_donation_id;
    END IF;
END;
$$;

-- ---------- Part B: procedures ----------
CREATE OR REPLACE PROCEDURE schedule_pickup(p_allocation_id UUID, p_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE pickups SET status = 'scheduled', scheduled_at = p_at WHERE allocation_id = p_allocation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No pickup for allocation % (or not visible to this organization)', p_allocation_id;
    END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE complete_pickup(p_allocation_id UUID)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE pickups SET status = 'completed' WHERE allocation_id = p_allocation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No pickup for allocation % (or not visible to this organization)', p_allocation_id;
    END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE mark_pickup_missed(p_allocation_id UUID)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE pickups SET status = 'missed' WHERE allocation_id = p_allocation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No pickup for allocation % (or not visible to this organization)', p_allocation_id;
    END IF;
END;
$$;

-- Recipient confirms the food arrived: allocation completed, donation COMPLETED
CREATE OR REPLACE PROCEDURE confirm_receipt(p_allocation_id UUID)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE allocations SET status = 'completed' WHERE allocation_id = p_allocation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Allocation % not found (or not visible to this organization)', p_allocation_id;
    END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE cancel_allocation(p_allocation_id UUID)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE allocations SET status = 'cancelled' WHERE allocation_id = p_allocation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Allocation % not found (or not visible to this organization)', p_allocation_id;
    END IF;
END;
$$;

\df public.*


/* ======================================================================
   SECTION 9: TRIGGERS
   Created after the seed data, which is already a consistent snapshot.

   Donation lifecycle enforced below:
     DRAFT -> AVAILABLE -> ALLOCATED -> PICKED_UP -> COMPLETED
     DRAFT/AVAILABLE -> EXPIRED (automatic), any open state -> CANCELLED,
     ALLOCATED -> AVAILABLE when the allocation is cancelled or the pickup is missed
   ====================================================================== */
\echo '==================== SECTION 9: TRIGGERS ===================='

-- ---------- Part A ----------
-- A.T1 BEFORE INSERT/UPDATE on donations: validates the lister, forces new
--      listings to DRAFT, gates publishing, auto-expires on any write and
--      enforces the status state machine.
CREATE OR REPLACE FUNCTION trg_donations_before_write() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_role   TEXT;
    v_org    UUID;
    v_active BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT role, org_id, is_active INTO v_role, v_org, v_active
          FROM users WHERE user_id = NEW.created_by;
        IF NOT FOUND OR NOT v_active THEN
            RAISE EXCEPTION 'User % does not exist or is inactive', NEW.created_by;
        END IF;
        IF v_role NOT IN ('donor', 'admin') OR v_org <> NEW.org_id THEN
            RAISE EXCEPTION 'User % (role %) cannot list donations for organization %',
                            NEW.created_by, v_role, NEW.org_id;
        END IF;
        IF NEW.expires_at <= now() THEN
            RAISE EXCEPTION 'expires_at (%) must be in the future', NEW.expires_at;
        END IF;
        NEW.status     := 'DRAFT';
        NEW.updated_at := now();
        RETURN NEW;
    END IF;

    -- UPDATE
    IF NEW.org_id <> OLD.org_id THEN
        RAISE EXCEPTION 'The donor organization of donation % cannot be changed', OLD.donation_id;
    END IF;
    NEW.updated_at := now();

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF OLD.status IN ('COMPLETED', 'EXPIRED', 'CANCELLED') THEN
            RAISE EXCEPTION 'Donation % is % (terminal) and cannot change to %',
                            OLD.donation_id, OLD.status, NEW.status;
        END IF;
        IF OLD.status = 'DRAFT' AND NEW.status = 'AVAILABLE' THEN
            IF NOT EXISTS (SELECT 1 FROM food_items WHERE donation_id = NEW.donation_id) THEN
                RAISE EXCEPTION 'Donation % cannot be published without any food items', NEW.donation_id;
            END IF;
            IF NEW.expires_at <= now() THEN
                RAISE EXCEPTION 'Donation % cannot be published: it expired at %',
                                NEW.donation_id, NEW.expires_at;
            END IF;
        END IF;
    END IF;

    -- Auto-expiry on any write once the deadline has passed
    IF NEW.status IN ('DRAFT', 'AVAILABLE') AND NEW.expires_at <= now() THEN
        NEW.status := 'EXPIRED';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
           (OLD.status = 'DRAFT'     AND NEW.status IN ('AVAILABLE', 'CANCELLED', 'EXPIRED'))
        OR (OLD.status = 'AVAILABLE' AND NEW.status IN ('ALLOCATED', 'CANCELLED', 'EXPIRED'))
        OR (OLD.status = 'ALLOCATED' AND NEW.status IN ('PICKED_UP', 'AVAILABLE', 'CANCELLED', 'EXPIRED'))
        OR (OLD.status = 'PICKED_UP' AND NEW.status = 'COMPLETED')) THEN
        RAISE EXCEPTION 'Illegal status change % -> % for donation %',
                        OLD.status, NEW.status, OLD.donation_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_donations_before_write
    BEFORE INSERT OR UPDATE ON donations
    FOR EACH ROW EXECUTE FUNCTION trg_donations_before_write();

-- A.T2 status_history row for every donation insert and status change
CREATE OR REPLACE FUNCTION trg_donations_history() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO status_history (entity_type, donation_id, old_status, new_status, changed_by)
        VALUES ('donation', NEW.donation_id, NULL, NEW.status::TEXT, current_app_user_id());
    ELSE
        INSERT INTO status_history (entity_type, donation_id, old_status, new_status, changed_by)
        VALUES ('donation', NEW.donation_id, OLD.status::TEXT, NEW.status::TEXT, current_app_user_id());
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_donations_history_insert
    AFTER INSERT ON donations
    FOR EACH ROW EXECUTE FUNCTION trg_donations_history();

-- WHEN clause (not "UPDATE OF status"): status is often changed by other
-- triggers or by A.T1 itself even when the statement never names the column
CREATE OR REPLACE TRIGGER trg_donations_history_status
    AFTER UPDATE ON donations
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION trg_donations_history();

-- A.T3 Transactional outbox for the Qdrant index:
--      publish -> UPSERT, text/tag edit while live -> UPSERT, finished or deleted -> DELETE
CREATE OR REPLACE FUNCTION trg_donations_outbox() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO vector_sync_outbox (donation_id, op) VALUES (OLD.donation_id, 'DELETE');
        RETURN NULL;
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.status = 'AVAILABLE' THEN
        INSERT INTO vector_sync_outbox (donation_id, op) VALUES (NEW.donation_id, 'UPSERT');
    ELSIF NEW.status IN ('COMPLETED', 'EXPIRED', 'CANCELLED') AND OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO vector_sync_outbox (donation_id, op) VALUES (NEW.donation_id, 'DELETE');
    ELSIF NEW.status <> 'DRAFT'
      AND (NEW.description, NEW.dietary_tags) IS DISTINCT FROM (OLD.description, OLD.dietary_tags) THEN
        INSERT INTO vector_sync_outbox (donation_id, op) VALUES (NEW.donation_id, 'UPSERT');
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_donations_outbox
    AFTER UPDATE OR DELETE ON donations
    FOR EACH ROW EXECUTE FUNCTION trg_donations_outbox();

-- A.T4 Food items can only change while the listing is DRAFT or AVAILABLE;
--      an edit to a live listing queues a re-embedding.
CREATE OR REPLACE FUNCTION trg_food_items_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_donation UUID;
    v_status   donation_status;
BEGIN
    v_donation := CASE WHEN TG_OP = 'DELETE' THEN OLD.donation_id ELSE NEW.donation_id END;
    SELECT status INTO v_status FROM donations WHERE donation_id = v_donation;
    -- Not found = the parent donation is itself being deleted (cascade): allow
    IF FOUND THEN
        IF v_status NOT IN ('DRAFT', 'AVAILABLE') THEN
            RAISE EXCEPTION 'Food items of donation % cannot change once it is %', v_donation, v_status;
        END IF;
        IF v_status = 'AVAILABLE' THEN
            INSERT INTO vector_sync_outbox (donation_id, op) VALUES (v_donation, 'UPSERT');
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE TRIGGER trg_food_items_guard
    BEFORE INSERT OR UPDATE OR DELETE ON food_items
    FOR EACH ROW EXECUTE FUNCTION trg_food_items_guard();

-- A.T5 Cancelling an allocated listing cancels its active allocation
CREATE OR REPLACE FUNCTION trg_donations_cancel_allocation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE allocations SET status = 'cancelled'
     WHERE donation_id = NEW.donation_id AND status = 'confirmed';
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_donations_cancel_allocation
    AFTER UPDATE ON donations
    FOR EACH ROW WHEN (OLD.status = 'ALLOCATED' AND NEW.status = 'CANCELLED')
    EXECUTE FUNCTION trg_donations_cancel_allocation();

-- ---------- Part B ----------
-- B.T1 BEFORE INSERT on allocations: the matching rules
CREATE OR REPLACE FUNCTION trg_allocations_before_insert() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_d donations%ROWTYPE;
    v_r requirements%ROWTYPE;
BEGIN
    SELECT * INTO v_d FROM donations    WHERE donation_id    = NEW.donation_id;
    SELECT * INTO v_r FROM requirements WHERE requirement_id = NEW.requirement_id;

    IF NOT v_r.active THEN
        RAISE EXCEPTION 'Requirement % is no longer active', NEW.requirement_id;
    END IF;
    IF NEW.recipient_org_id IS DISTINCT FROM v_r.org_id THEN
        RAISE EXCEPTION 'Recipient must be the organization that posted requirement %', NEW.requirement_id;
    END IF;
    IF v_d.org_id = v_r.org_id THEN
        RAISE EXCEPTION 'Organization % cannot receive its own donation %', v_r.org_id, NEW.donation_id;
    END IF;
    IF v_d.status <> 'AVAILABLE' THEN
        RAISE EXCEPTION 'Donation % is not available (status: %)', NEW.donation_id, v_d.status;
    END IF;
    IF NOT (v_d.dietary_tags @> v_r.dietary_constraints) THEN
        RAISE EXCEPTION 'Donation % (tags %) does not meet the dietary needs % of requirement %',
                        NEW.donation_id, v_d.dietary_tags, v_r.dietary_constraints, NEW.requirement_id;
    END IF;
    IF v_d.quantity > v_r.max_capacity THEN
        RAISE EXCEPTION 'Donation % has % servings, above the capacity % of requirement %',
                        NEW.donation_id, v_d.quantity, v_r.max_capacity, NEW.requirement_id;
    END IF;

    NEW.quantity   := v_d.quantity;      -- whole donation
    NEW.status     := 'confirmed';
    NEW.created_at := now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_allocations_before_insert
    BEFORE INSERT ON allocations
    FOR EACH ROW EXECUTE FUNCTION trg_allocations_before_insert();

-- B.T2 AFTER INSERT: mark the donation ALLOCATED and open a pending pickup
CREATE OR REPLACE FUNCTION trg_allocations_after_insert() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE donations SET status = 'ALLOCATED' WHERE donation_id = NEW.donation_id;
    INSERT INTO pickups (allocation_id) VALUES (NEW.allocation_id);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_allocations_after_insert
    AFTER INSERT ON allocations
    FOR EACH ROW EXECUTE FUNCTION trg_allocations_after_insert();

-- B.T3 BEFORE UPDATE: confirmed -> completed | cancelled, core fields immutable,
--      completion only after the pickup is done
CREATE OR REPLACE FUNCTION trg_allocations_before_update() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_pickup TEXT;
BEGIN
    IF (NEW.donation_id, NEW.requirement_id, NEW.recipient_org_id, NEW.quantity)
       IS DISTINCT FROM (OLD.donation_id, OLD.requirement_id, OLD.recipient_org_id, OLD.quantity) THEN
        RAISE EXCEPTION 'Allocation % is immutable; cancel it and allocate again', OLD.allocation_id;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF OLD.status <> 'confirmed' THEN
            RAISE EXCEPTION 'Allocation % is already % and cannot change to %',
                            OLD.allocation_id, OLD.status, NEW.status;
        END IF;
        IF NEW.status = 'completed' THEN
            SELECT status INTO v_pickup FROM pickups WHERE allocation_id = NEW.allocation_id;
            IF v_pickup IS DISTINCT FROM 'completed' THEN
                RAISE EXCEPTION 'Allocation % cannot be completed before its pickup is done (pickup is %)',
                                NEW.allocation_id, v_pickup;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_allocations_before_update
    BEFORE UPDATE ON allocations
    FOR EACH ROW EXECUTE FUNCTION trg_allocations_before_update();

-- B.T4 AFTER status change: cancelled releases the food (and closes the pickup);
--      completed closes the donation
CREATE OR REPLACE FUNCTION trg_allocations_after_status() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'cancelled' THEN
        UPDATE donations SET status = 'AVAILABLE'
         WHERE donation_id = NEW.donation_id AND status = 'ALLOCATED';
        UPDATE pickups SET status = 'cancelled'
         WHERE allocation_id = NEW.allocation_id AND status IN ('pending', 'scheduled');
    ELSIF NEW.status = 'completed' THEN
        UPDATE donations SET status = 'COMPLETED'
         WHERE donation_id = NEW.donation_id AND status = 'PICKED_UP';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_allocations_after_status
    AFTER UPDATE ON allocations
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION trg_allocations_after_status();

-- B.T5 status_history row for every allocation insert and status change
CREATE OR REPLACE FUNCTION trg_allocations_history() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO status_history (entity_type, allocation_id, donation_id, old_status, new_status, changed_by)
        VALUES ('allocation', NEW.allocation_id, NEW.donation_id, NULL, NEW.status,
                COALESCE(current_app_user_id(), NEW.allocated_by));
    ELSE
        INSERT INTO status_history (entity_type, allocation_id, donation_id, old_status, new_status, changed_by)
        VALUES ('allocation', NEW.allocation_id, NEW.donation_id, OLD.status, NEW.status, current_app_user_id());
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_allocations_history_insert
    AFTER INSERT ON allocations
    FOR EACH ROW EXECUTE FUNCTION trg_allocations_history();

CREATE OR REPLACE TRIGGER trg_allocations_history_status
    AFTER UPDATE ON allocations
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION trg_allocations_history();

-- B.T6 BEFORE INSERT/UPDATE on pickups: state machine and automatic timestamp
--      pending -> scheduled | completed | missed | cancelled
--      scheduled -> completed | missed | cancelled  (rescheduling allowed)
CREATE OR REPLACE FUNCTION trg_pickups_before_write() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_alloc_status TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.status := 'pending';
        NEW.picked_up_at := NULL;
        RETURN NEW;
    END IF;

    IF NEW.allocation_id <> OLD.allocation_id THEN
        RAISE EXCEPTION 'Pickup % cannot be moved to another allocation', OLD.pickup_id;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF OLD.status NOT IN ('pending', 'scheduled') THEN
            RAISE EXCEPTION 'Pickup % is already % and cannot change to %',
                            OLD.pickup_id, OLD.status, NEW.status;
        END IF;
        IF NEW.status = 'pending' THEN
            RAISE EXCEPTION 'Pickup % cannot go back to pending', OLD.pickup_id;
        END IF;
        IF NEW.status = 'completed' THEN
            SELECT status INTO v_alloc_status FROM allocations WHERE allocation_id = NEW.allocation_id;
            IF v_alloc_status <> 'confirmed' THEN
                RAISE EXCEPTION 'Pickup % cannot complete: allocation is %', OLD.pickup_id, v_alloc_status;
            END IF;
            NEW.picked_up_at := clock_timestamp();
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_pickups_before_write
    BEFORE INSERT OR UPDATE ON pickups
    FOR EACH ROW EXECUTE FUNCTION trg_pickups_before_write();

-- B.T7 AFTER pickup status change: completed -> donation PICKED_UP,
--      missed -> allocation cancelled (which releases the food via B.T4)
CREATE OR REPLACE FUNCTION trg_pickups_after_status() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'completed' THEN
        UPDATE donations SET status = 'PICKED_UP'
         WHERE donation_id = (SELECT donation_id FROM allocations WHERE allocation_id = NEW.allocation_id)
           AND status = 'ALLOCATED';
    ELSIF NEW.status = 'missed' THEN
        UPDATE allocations SET status = 'cancelled'
         WHERE allocation_id = NEW.allocation_id AND status = 'confirmed';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_pickups_after_status
    AFTER UPDATE ON pickups
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION trg_pickups_after_status();

SELECT event_object_table AS table_name, trigger_name,
       string_agg(event_manipulation, ' OR ' ORDER BY event_manipulation) AS events,
       action_timing AS timing
  FROM information_schema.triggers
 WHERE trigger_schema = 'public'
 GROUP BY event_object_table, trigger_name, action_timing
 ORDER BY table_name, trigger_name;


/* ======================================================================
   SECTION 10: ROLES AND PRIVILEGES
   Group roles (NOLOGIN) hold privileges; login roles inherit them.
   ====================================================================== */
\echo '==================== SECTION 10: ROLES AND PRIVILEGES ===================='

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodlink_admin') THEN
        CREATE ROLE foodlink_admin NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodlink_app') THEN
        CREATE ROLE foodlink_app NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodlink_analyst') THEN
        CREATE ROLE foodlink_analyst NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodlink_dba') THEN
        CREATE ROLE foodlink_dba LOGIN PASSWORD 'FoodLinkDba@2026';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodlink_web') THEN
        CREATE ROLE foodlink_web LOGIN PASSWORD 'FoodLinkWeb@2026' CONNECTION LIMIT 20;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodlink_report') THEN
        CREATE ROLE foodlink_report LOGIN PASSWORD 'FoodLinkReport@2026' CONNECTION LIMIT 3;
    END IF;
    -- Only the FoodLink groups (and superusers) may connect to this database
    EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO foodlink_admin, foodlink_app, foodlink_analyst',
                   current_database());
END
$$;

GRANT foodlink_admin   TO foodlink_dba;
GRANT foodlink_app     TO foodlink_web;      -- the Next.js server actions connect as this
GRANT foodlink_analyst TO foodlink_report;

-- Least privilege: start from nothing on our objects
REVOKE ALL ON ALL TABLES   IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO foodlink_admin, foodlink_app, foodlink_analyst;

-- Admin: full control of data objects
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO foodlink_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO foodlink_admin;
GRANT EXECUTE        ON ALL ROUTINES  IN SCHEMA public TO foodlink_admin;

-- App: read/write, but no DELETE except on draft line items (soft delete via CANCELLED);
-- status_history and the outbox are insert-only (written by triggers as the caller)
GRANT SELECT, INSERT, UPDATE ON organizations, users, donations, food_items,
                                requirements, allocations, pickups           TO foodlink_app;
GRANT DELETE                 ON food_items                                    TO foodlink_app;
GRANT INSERT                 ON status_history                                TO foodlink_app;
GRANT SELECT, INSERT         ON vector_sync_outbox                            TO foodlink_app;
GRANT UPDATE (processed_at)  ON vector_sync_outbox                            TO foodlink_app;  -- column-level
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public                                 TO foodlink_app;
GRANT SELECT ON v_available_donations                                         TO foodlink_app;
GRANT EXECUTE ON FUNCTION
      current_org_id(), current_app_user_id(),
      haversine_km(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION),
      donor_waste_rate(UUID), expire_stale_donations(), recipient_fulfilment_rate(UUID),
      allocate_donation(UUID, UUID, UUID),
      find_matching_donations(UUID, DOUBLE PRECISION, UUID[])
   TO foodlink_app;
GRANT EXECUTE ON PROCEDURE
      create_donation(UUID, UUID, TEXT, TEXT[], NUMERIC, INTERVAL, JSONB, UUID),
      publish_donation(UUID), cancel_donation(UUID),
      schedule_pickup(UUID, TIMESTAMPTZ), complete_pickup(UUID), mark_pickup_missed(UUID),
      confirm_receipt(UUID), cancel_allocation(UUID)
   TO foodlink_app;

-- Analyst: read-only reporting; the column-level grant hides email and password_hash
GRANT SELECT ON v_available_donations, v_allocation_details, mv_donor_impact,
                status_history, organizations, requirements                  TO foodlink_analyst;
GRANT SELECT (user_id, org_id, name, role, is_active, created_at) ON users   TO foodlink_analyst;

SELECT r.rolname, r.rolcanlogin AS can_login, r.rolconnlimit AS conn_limit,
       COALESCE(string_agg(g.rolname, ', '), '-') AS member_of
  FROM pg_roles r
  LEFT JOIN pg_auth_members m ON m.member = r.oid
  LEFT JOIN pg_roles g        ON g.oid    = m.roleid
 WHERE r.rolname LIKE 'foodlink%'
 GROUP BY r.rolname, r.rolcanlogin, r.rolconnlimit
 ORDER BY r.rolname;

SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee LIKE 'foodlink%'
 GROUP BY grantee, table_name
 ORDER BY grantee, table_name;

SELECT grantee, table_name, string_agg(column_name, ', ' ORDER BY column_name) AS columns, privilege_type
  FROM information_schema.column_privileges
 WHERE table_schema = 'public'
   AND ((grantee = 'foodlink_analyst' AND table_name = 'users'              AND privilege_type = 'SELECT')
     OR (grantee = 'foodlink_app'     AND table_name = 'vector_sync_outbox' AND privilege_type = 'UPDATE'))
 GROUP BY grantee, table_name, privilege_type;


/* ======================================================================
   SECTION 11: ROW-LEVEL SECURITY
   - allocations: an organization sees allocations it received and allocations
     of its own donations; it can only create allocations for itself
   - pickups: visible exactly when their allocation is
   - requirements: everyone can read (needed for matching); only the owning
     organization can create or edit
   With no organization set in the session, current_org_id() is NULL and the
   app sees no allocations at all (fail-closed).
   ====================================================================== */
\echo '==================== SECTION 11: ROW-LEVEL SECURITY ===================='

ALTER TABLE allocations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alloc_app_select   ON allocations;
DROP POLICY IF EXISTS alloc_app_insert   ON allocations;
DROP POLICY IF EXISTS alloc_app_update   ON allocations;
DROP POLICY IF EXISTS alloc_admin_all    ON allocations;
DROP POLICY IF EXISTS pickup_app_select  ON pickups;
DROP POLICY IF EXISTS pickup_app_insert  ON pickups;
DROP POLICY IF EXISTS pickup_app_update  ON pickups;
DROP POLICY IF EXISTS pickup_admin_all   ON pickups;
DROP POLICY IF EXISTS req_read_all       ON requirements;
DROP POLICY IF EXISTS req_app_insert     ON requirements;
DROP POLICY IF EXISTS req_app_update     ON requirements;
DROP POLICY IF EXISTS req_admin_all      ON requirements;

CREATE POLICY alloc_app_select ON allocations FOR SELECT TO foodlink_app
    USING (recipient_org_id = current_org_id()
           OR EXISTS (SELECT 1 FROM donations d
                       WHERE d.donation_id = allocations.donation_id
                         AND d.org_id = current_org_id()));
CREATE POLICY alloc_app_insert ON allocations FOR INSERT TO foodlink_app
    WITH CHECK (recipient_org_id = current_org_id());
CREATE POLICY alloc_app_update ON allocations FOR UPDATE TO foodlink_app
    USING (recipient_org_id = current_org_id()
           OR EXISTS (SELECT 1 FROM donations d
                       WHERE d.donation_id = allocations.donation_id
                         AND d.org_id = current_org_id()));

-- The subquery on allocations is itself filtered by the allocation policies
CREATE POLICY pickup_app_select ON pickups FOR SELECT TO foodlink_app
    USING (EXISTS (SELECT 1 FROM allocations a WHERE a.allocation_id = pickups.allocation_id));
CREATE POLICY pickup_app_insert ON pickups FOR INSERT TO foodlink_app
    WITH CHECK (EXISTS (SELECT 1 FROM allocations a WHERE a.allocation_id = pickups.allocation_id));
CREATE POLICY pickup_app_update ON pickups FOR UPDATE TO foodlink_app
    USING (EXISTS (SELECT 1 FROM allocations a WHERE a.allocation_id = pickups.allocation_id));

CREATE POLICY req_read_all   ON requirements FOR SELECT TO foodlink_app, foodlink_analyst USING (true);
CREATE POLICY req_app_insert ON requirements FOR INSERT TO foodlink_app WITH CHECK (org_id = current_org_id());
CREATE POLICY req_app_update ON requirements FOR UPDATE TO foodlink_app USING (org_id = current_org_id());

CREATE POLICY alloc_admin_all  ON allocations  FOR ALL TO foodlink_admin USING (true) WITH CHECK (true);
CREATE POLICY pickup_admin_all ON pickups      FOR ALL TO foodlink_admin USING (true) WITH CHECK (true);
CREATE POLICY req_admin_all    ON requirements FOR ALL TO foodlink_admin USING (true) WITH CHECK (true);

SELECT tablename, policyname, cmd, roles FROM pg_policies
 WHERE schemaname = 'public' ORDER BY tablename, policyname;


/* ======================================================================
   SECTION 12: TESTS FOR VIEWS, FUNCTIONS, PROCEDURES, TRIGGERS, ROLES, RLS
   ====================================================================== */
\echo '==================== SECTION 12: TESTS ===================='

-- psql shortcuts for the seed IDs used below
\set O1  '10000000-0000-0000-0000-000000000001'
\set O2  '10000000-0000-0000-0000-000000000002'
\set O3  '10000000-0000-0000-0000-000000000003'
\set O4  '10000000-0000-0000-0000-000000000004'
\set O7  '10000000-0000-0000-0000-000000000007'
\set O10 '10000000-0000-0000-0000-000000000010'
\set O11 '10000000-0000-0000-0000-000000000011'
\set O12 '10000000-0000-0000-0000-000000000012'
\set U1  '20000000-0000-0000-0000-000000000001'
\set U4  '20000000-0000-0000-0000-000000000004'
\set U8  '20000000-0000-0000-0000-000000000008'
\set U11 '20000000-0000-0000-0000-000000000011'
\set D1  '30000000-0000-0000-0000-000000000001'
\set D2  '30000000-0000-0000-0000-000000000002'
\set D3  '30000000-0000-0000-0000-000000000003'
\set D4  '30000000-0000-0000-0000-000000000004'
\set D5  '30000000-0000-0000-0000-000000000005'
\set D6  '30000000-0000-0000-0000-000000000006'
\set D8  '30000000-0000-0000-0000-000000000008'
\set D9  '30000000-0000-0000-0000-000000000009'
\set D16 '30000000-0000-0000-0000-000000000016'
\set R1  '50000000-0000-0000-0000-000000000001'
\set R3  '50000000-0000-0000-0000-000000000003'
\set R4  '50000000-0000-0000-0000-000000000004'
\set R7  '50000000-0000-0000-0000-000000000007'
\set R10 '50000000-0000-0000-0000-000000000010'
\set A2  '60000000-0000-0000-0000-000000000002'

-- ---------- Part A ----------
\echo '--- 12.1 View and functions ---'
SELECT donor_org, description, servings, items, hours_to_expiry
  FROM v_available_donations ORDER BY hours_to_expiry;
SELECT round(haversine_km(a.lat, a.lng, b.lat, b.lng)::NUMERIC, 2) AS akshaya_to_annapoorna_km
  FROM organizations a, organizations b WHERE a.org_id = :'O3' AND b.org_id = :'O1';
SELECT donor_waste_rate(:'O11')          AS techcorp_waste_pct,
       donor_waste_rate(:'O1')           AS annapoorna_waste_pct,
       recipient_fulfilment_rate(:'O4')  AS hope_fulfilment_pct,
       recipient_fulfilment_rate(:'O12') AS annadana_fulfilment_pct;

\echo '--- 12.2 create_donation (JSON items) -> DRAFT, then publish_donation -> AVAILABLE ---'
SELECT set_config('app.current_user_id', :'U8', false) AS acting_user;
CALL create_donation(:'O7', :'U8', 'Lemon rice packed in eco boxes', ARRAY['vegetarian', 'eggless', 'nut_free'],
                     35, interval '6 hours',
                     '[{"name":"Lemon rice","quantity":35,"unit":"packs"},
                       {"name":"Papad","quantity":35,"unit":"pieces"}]') \gset new_
SELECT description, status, quantity AS servings FROM donations WHERE donation_id = :'new_p_donation_id';
SELECT name, quantity, unit FROM food_items WHERE donation_id = :'new_p_donation_id' ORDER BY name;
CALL publish_donation(:'new_p_donation_id');
SELECT old_status, new_status, changed_by, db_user FROM status_history
 WHERE donation_id = :'new_p_donation_id' ORDER BY changed_at;
SELECT op, processed_at FROM vector_sync_outbox WHERE donation_id = :'new_p_donation_id';

-- ---------- Part B ----------
\echo '--- 12.3 Matching: Hope Foundation lunch programme (vegetarian, max 50) within 10 km ---'
SELECT description, donor_org, servings, dietary_tags, distance_km, hours_to_expiry
  FROM find_matching_donations(:'R3', 10);

\echo '--- 12.4 Matching: simulated Qdrant recall [D2, D8, D1, D5, D16] for Little Stars snacks (veg + eggless, max 35) ---'
-- D2 is already allocated and D1 has 40 servings (> 35), so PostgreSQL drops them
-- and keeps Qdrant's ranking for the rest
SELECT description, donor_org, servings, distance_km
  FROM find_matching_donations(:'R7', 12, ARRAY[:'D2', :'D8', :'D1', :'D5', :'D16']::UUID[]);

\echo '--- 12.5 allocate_donation (FOR UPDATE): fruit crates -> Hope Foundation produce requirement ---'
SELECT set_config('app.current_user_id', :'U4', false) AS acting_user;
SELECT allocate_donation(:'D3', :'R4', :'U4') AS alloc_produce \gset
SELECT description, status FROM donations WHERE donation_id = :'D3';
SELECT status AS pickup_status, scheduled_at FROM pickups WHERE allocation_id = :'alloc_produce';

\echo '--- 12.6 Pickup lifecycle: schedule -> complete -> confirm receipt ---'
CALL schedule_pickup(:'alloc_produce', now() + interval '2 hours');
CALL complete_pickup(:'alloc_produce');
SELECT status, picked_up_at FROM pickups WHERE allocation_id = :'alloc_produce';
SELECT description, status FROM donations WHERE donation_id = :'D3';                 -- PICKED_UP
CALL confirm_receipt(:'alloc_produce');
SELECT status FROM allocations WHERE allocation_id = :'alloc_produce';               -- completed
SELECT description, status FROM donations WHERE donation_id = :'D3';                 -- COMPLETED
SELECT entity_type, old_status, new_status FROM status_history
 WHERE donation_id = :'D3' ORDER BY changed_at, history_id;

\echo '--- 12.7 Missed pickup releases the food: milk -> Little Stars, pickup missed ---'
SELECT allocate_donation(:'D6', :'R10', :'U11') AS alloc_milk \gset
SELECT description, status FROM donations WHERE donation_id = :'D6';                 -- ALLOCATED
CALL mark_pickup_missed(:'alloc_milk');
SELECT a.status AS allocation_status, p.status AS pickup_status
  FROM allocations a JOIN pickups p USING (allocation_id) WHERE a.allocation_id = :'alloc_milk';
SELECT description, status FROM donations WHERE donation_id = :'D6';                 -- AVAILABLE again

\echo '--- 12.8 Transaction with SAVEPOINT ---'
BEGIN;
    SELECT allocate_donation(:'D8', :'R7', :'U11') AS alloc_idli \gset
    SAVEPOINT before_second_allocation;
    SELECT allocate_donation(:'D1', :'R3', :'U4') AS rolled_back_allocation;
    ROLLBACK TO SAVEPOINT before_second_allocation;
COMMIT;
SELECT description, status FROM donations WHERE donation_id IN (:'D8', :'D1') ORDER BY description;

\echo '--- 12.9 Auto-expiry, trigger path: any write after the deadline expires the listing ---'
UPDATE donations SET expires_at = now() WHERE donation_id = :'D6';
SELECT description, status FROM donations WHERE donation_id = :'D6';

\echo '--- 12.10 Auto-expiry, batch path: a listing expires with nothing writing to it ---'
SELECT set_config('app.current_user_id', :'U1', false) AS acting_user;
CALL create_donation(:'O1', :'U1', 'Masala dosa batter in 2 kg tubs', ARRAY['vegetarian', 'vegan'],
                     8, interval '3 seconds', '[{"name":"Dosa batter","quantity":4,"unit":"tubs"}]') \gset batch_
CALL publish_donation(:'batch_p_donation_id');
SELECT pg_sleep(4);
SELECT description, status, expires_at < now() AS deadline_passed
  FROM donations WHERE donation_id = :'batch_p_donation_id';                         -- still AVAILABLE
SELECT expire_stale_donations() AS listings_expired;
SELECT description, status FROM donations WHERE donation_id = :'batch_p_donation_id';

\echo '--- 12.11 cancel_donation on an allocated listing cascades to allocation and pickup ---'
SELECT a.status AS allocation_status, p.status AS pickup_status
  FROM allocations a JOIN pickups p USING (allocation_id) WHERE a.allocation_id = :'A2';
CALL cancel_donation(:'D4');
SELECT description, status FROM donations WHERE donation_id = :'D4';
SELECT a.status AS allocation_status, p.status AS pickup_status
  FROM allocations a JOIN pickups p USING (allocation_id) WHERE a.allocation_id = :'A2';

\echo '--- 12.12 Deleting a draft: items and history cascade, the Qdrant DELETE survives ---'
SELECT (SELECT count(*) FROM food_items     WHERE donation_id = :'D9') AS items_before,
       (SELECT count(*) FROM status_history WHERE donation_id = :'D9') AS history_before;
DELETE FROM donations WHERE donation_id = :'D9';
SELECT (SELECT count(*) FROM food_items     WHERE donation_id = :'D9') AS items_after,
       (SELECT count(*) FROM status_history WHERE donation_id = :'D9') AS history_after;
SELECT op, enqueued_at FROM vector_sync_outbox WHERE donation_id = :'D9';

\echo '--- 12.13 Full-text search (GIN expression index) ---'
SELECT description, status,
       round(ts_rank(to_tsvector('english', description), q)::NUMERIC, 4) AS rank
  FROM donations, to_tsquery('english', 'rice | bread') AS q
 WHERE to_tsvector('english', description) @@ q
 ORDER BY rank DESC, description;

\echo '--- 12.14 Array containment (GIN): listings that are both vegan and gluten free ---'
SELECT description, dietary_tags, status FROM donations
 WHERE dietary_tags @> ARRAY['vegan', 'gluten_free']
 ORDER BY description;

\echo '--- 12.15 Query plans: each index is usable ---'
-- Seed data is tiny, so the planner rightly prefers sequential scans; disabling
-- them for this transaction only shows which index each query would use.
BEGIN;
SET LOCAL enable_seqscan = off;
EXPLAIN (COSTS OFF) SELECT donation_id FROM donations
 WHERE status = 'AVAILABLE' AND expires_at < now() + interval '6 hours';
EXPLAIN (COSTS OFF) SELECT donation_id FROM donations WHERE dietary_tags @> ARRAY['vegetarian', 'eggless'];
EXPLAIN (COSTS OFF) SELECT donation_id FROM donations
 WHERE to_tsvector('english', description) @@ to_tsquery('english', 'bread');
EXPLAIN (COSTS OFF) SELECT requirement_id FROM requirements
 WHERE dietary_constraints <@ ARRAY['vegetarian', 'eggless', 'nut_free'];
EXPLAIN (COSTS OFF) SELECT user_id FROM users WHERE lower(email) = lower('Anita@Akshaya.org');
EXPLAIN (COSTS OFF) SELECT allocation_id FROM allocations
 WHERE recipient_org_id = '10000000-0000-0000-0000-000000000003' ORDER BY created_at DESC;
EXPLAIN (COSTS OFF) SELECT history_id FROM status_history WHERE changed_at >= now() - interval '1 day';
COMMIT;

\echo '--- 12.16 Row-level security: same query, different organization ---'
RESET app.current_user_id;
SET ROLE foodlink_app;
SELECT current_user, count(*) AS visible_allocations_without_org FROM allocations;   -- 0, fail-closed
SELECT set_config('app.current_org_id', :'O4', false) AS session_org;                -- Hope Foundation (recipient)
SELECT d.description AS donation, o.name AS recipient_org, a.status AS allocation_status
  FROM allocations a JOIN donations d USING (donation_id) JOIN organizations o ON o.org_id = a.recipient_org_id
 ORDER BY a.created_at;
SELECT set_config('app.current_org_id', :'O2', false) AS session_org;                -- Green Leaf Caterers (donor)
SELECT d.description AS donation, o.name AS recipient_org, a.status AS allocation_status
  FROM allocations a JOIN donations d USING (donation_id) JOIN organizations o ON o.org_id = a.recipient_org_id
 ORDER BY a.created_at;
\echo '--- Hope Foundation tries to edit Akshaya''s requirement: 0 rows updated ---'
SELECT set_config('app.current_org_id', :'O4', false) AS session_org;
UPDATE requirements SET max_capacity = 1 WHERE requirement_id = :'R1';
\echo '--- Little Stars completes its own pickup through the procedure (allowed) ---'
SELECT set_config('app.current_org_id', :'O10', false) AS session_org;
CALL complete_pickup(:'alloc_idli');
SELECT status, picked_up_at FROM pickups WHERE allocation_id = :'alloc_idli';
RESET app.current_org_id;
RESET ROLE;

\echo '--- 12.17 Column-level privilege: analyst reads permitted columns only ---'
SET ROLE foodlink_analyst;
SELECT current_user, name, role, is_active FROM users ORDER BY name;
SELECT donation, donor_org, recipient_org, allocation_status, pickup_status
  FROM v_allocation_details ORDER BY donation;
RESET ROLE;

\echo '--- 12.18 Materialized view refresh (CONCURRENTLY keeps it readable) ---'
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_donor_impact;
SELECT donor_org, published, completed, expired, servings_delivered, recipients_served, waste_pct, impact_rank
  FROM mv_donor_impact ORDER BY impact_rank, donor_org;

\echo '--- 12.19 Final lifecycle of every listing, and pending Qdrant work ---'
SELECT d.description, d.status,
       string_agg(h.new_status, ' -> ' ORDER BY h.changed_at, h.history_id) AS status_path
  FROM donations d
  JOIN status_history h ON h.donation_id = d.donation_id AND h.entity_type = 'donation'
 GROUP BY d.donation_id, d.description, d.status
 ORDER BY min(h.changed_at);
SELECT o.op, d.description, o.enqueued_at
  FROM vector_sync_outbox o LEFT JOIN donations d USING (donation_id)
 WHERE o.processed_at IS NULL ORDER BY o.outbox_id;


/* ======================================================================
   SECTION 13: NEGATIVE TESTS
   Every statement below is meant to FAIL. ON_ERROR_STOP is switched off so
   the whole section runs and each ERROR is printed for the screenshots.
   ====================================================================== */
\echo '==================== SECTION 13: NEGATIVE TESTS (each must ERROR) ===================='
\set ON_ERROR_STOP off
\set U3  '20000000-0000-0000-0000-000000000003'
\set U6  '20000000-0000-0000-0000-000000000006'
\set U10 '20000000-0000-0000-0000-000000000010'
\set O6  '10000000-0000-0000-0000-000000000006'
\set O9  '10000000-0000-0000-0000-000000000009'
\set D10 '30000000-0000-0000-0000-000000000010'
\set D12 '30000000-0000-0000-0000-000000000012'
\set R2  '50000000-0000-0000-0000-000000000002'
\set R5  '50000000-0000-0000-0000-000000000005'
\set R11 '50000000-0000-0000-0000-000000000011'
\set A1  '60000000-0000-0000-0000-000000000001'
\set A5  '60000000-0000-0000-0000-000000000005'
\set P1  '70000000-0000-0000-0000-000000000001'
\set P3  '70000000-0000-0000-0000-000000000003'

\echo '--- N1 CHECK: coordinates out of range ---'
INSERT INTO organizations (name, address, lat, lng) VALUES ('Bad Location Org', 'Nowhere', 123.0, 77.5);

\echo '--- N2 CHECK: malformed email ---'
INSERT INTO users (org_id, name, email, password_hash, role)
VALUES (:'O3', 'No Email', 'not-an-email', 'x', 'recipient');

\echo '--- N3 Expression unique index: same email in different case ---'
INSERT INTO users (org_id, name, email, password_hash, role)
VALUES (:'O3', 'Duplicate Anita', 'ANITA@Akshaya.org', 'x', 'recipient');

\echo '--- N4 CHECK: dietary tag outside the vocabulary ---'
INSERT INTO requirements (org_id, created_by, description, dietary_constraints, max_capacity)
VALUES (:'O3', :'U3', 'Keto meals', '{keto}', 10);

\echo '--- N5 Review-1 CHECK valid_expiry: expires before it was prepared ---'
INSERT INTO donations (org_id, created_by, description, quantity, prepared_at, expires_at, pickup_lat, pickup_lng)
VALUES (:'O1', :'U1', 'Backwards dates', 5, now() + interval '2 hours', now() + interval '1 hour', 12.92, 77.59);

\echo '--- N6 Trigger A.T1: a recipient user cannot list donations ---'
CALL create_donation(:'O3', :'U3', 'Shelter leftovers', '{}', 5, interval '2 hours', '[]');

\echo '--- N7 Trigger A.T1: expiry in the past ---'
CALL create_donation(:'O1', :'U1', 'Already expired', '{}', 5, interval '-1 hour', '[]');

\echo '--- N8 Trigger A.T1: publishing a draft with no food items (draft is created, publish fails) ---'
CALL create_donation(:'O1', :'U1', 'Empty listing', '{}', 5, interval '2 hours', '[]') \gset empty_
CALL publish_donation(:'empty_p_donation_id');

\echo '--- N9 Trigger A.T1: illegal status jump AVAILABLE -> COMPLETED ---'
UPDATE donations SET status = 'COMPLETED' WHERE donation_id = :'D1';

\echo '--- N10 Trigger A.T1: an expired listing cannot be revived ---'
UPDATE donations SET status = 'AVAILABLE' WHERE donation_id = :'D12';

\echo '--- N11 allocate_donation: listing already allocated ---'
SELECT allocate_donation(:'D2', :'R7', :'U11');

\echo '--- N12 Trigger B.T1: dietary mismatch (pulao is not jain) ---'
SELECT allocate_donation(:'D1', :'R2', :'U3');

\echo '--- N13 Trigger B.T1: 40 servings exceed a capacity of 30 ---'
SELECT allocate_donation(:'D1', :'R5', :'U6');

\echo '--- N14 Trigger B.T1: dual-role organization receiving its own donation ---'
SELECT allocate_donation(:'D16', :'R5', :'U6');

\echo '--- N15 allocate_donation: inactive requirement ---'
SELECT allocate_donation(:'D1', :'R11', :'U10');

\echo '--- N16 allocate_donation: a donor user cannot accept food ---'
SELECT allocate_donation(:'D1', :'R3', :'U1');

\echo '--- N17 Partial unique index: even with triggers bypassed, one active allocation per donation ---'
SET session_replication_role = replica;
INSERT INTO allocations (donation_id, requirement_id, recipient_org_id, quantity)
VALUES (:'D2', :'R7', :'O10', 25);
SET session_replication_role = DEFAULT;

\echo '--- N18 Trigger B.T3: a completed allocation cannot be cancelled ---'
CALL cancel_allocation(:'A5');

\echo '--- N19 Trigger B.T3: receipt confirmed before the pickup happened ---'
CALL confirm_receipt(:'A1');

\echo '--- N20 Trigger B.T6: a completed pickup cannot become missed ---'
UPDATE pickups SET status = 'missed' WHERE pickup_id = :'P3';

\echo '--- N21 CHECK: a scheduled pickup needs a time ---'
UPDATE pickups SET scheduled_at = NULL WHERE pickup_id = :'P1';

\echo '--- N22 Trigger A.T4: items of an allocated listing are frozen ---'
INSERT INTO food_items (donation_id, name, quantity, unit) VALUES (:'D2', 'Extra buns', 5, 'pieces');

\echo '--- N23 FK RESTRICT: organization that still has users ---'
DELETE FROM organizations WHERE org_id = :'O6';

\echo '--- N24 FK RESTRICT: listing that has allocations ---'
DELETE FROM donations WHERE donation_id = :'D10';

\echo '--- N25 RLS WITH CHECK: Hope Foundation session creating an allocation for Akshaya ---'
SET ROLE foodlink_app;
SELECT set_config('app.current_org_id', :'O4', false) AS session_org;
SELECT allocate_donation(:'D16', :'R1', :'U3');

\echo '--- N26 RLS USING: Sneha Old Age Home completing a pickup it cannot see ---'
SELECT set_config('app.current_org_id', :'O9', false) AS session_org;
CALL complete_pickup(:'A1');

\echo '--- N27 Privilege: the app role has no DELETE on donations ---'
DELETE FROM donations WHERE donation_id = :'D1';

\echo '--- N28 Privilege: status_history is insert-only for the app ---'
UPDATE status_history SET new_status = 'AVAILABLE';

\echo '--- N29 Privilege: the app cannot read the RLS-bypassing reporting view ---'
SELECT * FROM v_allocation_details;
RESET app.current_org_id;
RESET ROLE;

\echo '--- N30 Column privilege: analyst cannot read emails or password hashes ---'
SET ROLE foodlink_analyst;
SELECT email, password_hash FROM users;

\echo '--- N31 Privilege: analyst cannot read raw allocations ---'
SELECT * FROM allocations;
RESET ROLE;

\set ON_ERROR_STOP on
\echo '==================== DONE ===================='
