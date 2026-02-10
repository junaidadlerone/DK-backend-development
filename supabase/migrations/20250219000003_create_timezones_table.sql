-- Create timezones table
CREATE TABLE IF NOT EXISTS timezones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE timezones ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read timezones
CREATE POLICY "Allow read access to timezones" ON timezones
    FOR SELECT
    USING (true);

-- Insert all major timezones
INSERT INTO timezones (symbol, name) VALUES
    -- US Timezones
    ('UTC-5', 'Eastern Time (US)'),
    ('UTC-6', 'Central Time (US)'),
    ('UTC-7', 'Mountain Time (US)'),
    ('UTC-8', 'Pacific Time (US)'),
    ('UTC-9', 'Alaska Time (US)'),
    ('UTC-10', 'Hawaii-Aleutian Time (US)'),

    -- Other Americas
    ('UTC-3:30', 'Newfoundland Time'),
    ('UTC-4', 'Atlantic Time'),
    ('UTC-3', 'Argentina Time'),
    ('UTC-2', 'South Georgia Time'),

    -- Europe & Africa
    ('UTC+0', 'Greenwich Mean Time'),
    ('UTC+1', 'Central European Time'),
    ('UTC+2', 'Eastern European Time'),
    ('UTC+3', 'Moscow Time'),
    ('UTC+3:30', 'Iran Time'),
    ('UTC+4', 'Gulf Time'),
    ('UTC+4:30', 'Afghanistan Time'),

    -- Asia
    ('UTC+5', 'Pakistan Time'),
    ('UTC+5:30', 'India Time'),
    ('UTC+5:45', 'Nepal Time'),
    ('UTC+6', 'Bangladesh Time'),
    ('UTC+6:30', 'Myanmar Time'),
    ('UTC+7', 'Indochina Time'),
    ('UTC+8', 'China/Singapore Time'),
    ('UTC+9', 'Japan/Korea Time'),
    ('UTC+9:30', 'Australian Central Time'),
    ('UTC+10', 'Australian Eastern Time'),
    ('UTC+11', 'Solomon Islands Time'),
    ('UTC+12', 'New Zealand Time'),
    ('UTC+13', 'Samoa Time'),
    ('UTC+14', 'Line Islands Time');

-- Create index for faster lookups
CREATE INDEX idx_timezones_symbol ON timezones(symbol);
