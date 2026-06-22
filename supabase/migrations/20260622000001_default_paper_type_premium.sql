-- All campaigns are premium now (the frontend hardcodes the premium flag at
-- launch). Default new campaign rows to 'premium' instead of 'standard'.
ALTER TABLE campaigns ALTER COLUMN paper_type SET DEFAULT 'premium';
