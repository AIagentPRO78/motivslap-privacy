-- redstack M2 lab — synthetic seed data.
-- All identifiers are obviously fake (TEST- prefix, no real PII patterns).
-- The purpose is to give /web-app + /source-review realistic-looking
-- data-exposure scenarios without any real customer information.

CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    full_name   TEXT NOT NULL,
    test_id     TEXT NOT NULL,             -- shaped like TEST-NNN-NNNN
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Deliberately plaintext password for the lab scenario.
    -- Real fingerprint: any finding referencing this column is the finding.
    password    TEXT NOT NULL
);

INSERT INTO users (email, full_name, test_id, password) VALUES
    ('alice@example.invalid',   'Alice Labuser',    'TEST-001-0001', 'FAKEKEYLABPW1'),
    ('bob@example.invalid',     'Bob Labuser',      'TEST-001-0002', 'FAKEKEYLABPW2'),
    ('carol@example.invalid',   'Carol Labuser',    'TEST-001-0003', 'FAKEKEYLABPW3'),
    ('dave@example.invalid',    'Dave Labuser',     'TEST-001-0004', 'FAKEKEYLABPW4'),
    ('erin@example.invalid',    'Erin Labuser',     'TEST-001-0005', 'FAKEKEYLABPW5'),
    ('frank@example.invalid',   'Frank Labuser',    'TEST-001-0006', 'FAKEKEYLABPW6'),
    ('grace@example.invalid',   'Grace Labuser',    'TEST-001-0007', 'FAKEKEYLABPW7'),
    ('heidi@example.invalid',   'Heidi Labuser',    'TEST-001-0008', 'FAKEKEYLABPW8'),
    ('ivan@example.invalid',    'Ivan Labuser',     'TEST-001-0009', 'FAKEKEYLABPW9'),
    ('judy@example.invalid',    'Judy Labuser',     'TEST-001-0010', 'FAKEKEYLABPW10');

-- Deliberately over-permissive role for the lab scenario.
CREATE ROLE public_readonly LOGIN PASSWORD 'FAKEKEYLABPUBLIC';
GRANT CONNECT ON DATABASE lab TO public_readonly;
GRANT USAGE ON SCHEMA public TO public_readonly;
GRANT SELECT ON users TO public_readonly;

-- Deliberately missing: row-level security, column-level grants on password.
