-- Create currencies table
CREATE TABLE IF NOT EXISTS currencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    abbreviation TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read currencies
CREATE POLICY "Allow read access to currencies" ON currencies
    FOR SELECT
    USING (true);

-- Insert major world currencies
INSERT INTO currencies (symbol, name, abbreviation) VALUES
    -- Major currencies
    ('$', 'United States Dollar', 'USD'),
    ('€', 'Euro', 'EUR'),
    ('£', 'British Pound Sterling', 'GBP'),
    ('¥', 'Japanese Yen', 'JPY'),
    ('¥', 'Chinese Yuan', 'CNY'),
    ('₹', 'Indian Rupee', 'INR'),
    ('$', 'Canadian Dollar', 'CAD'),
    ('$', 'Australian Dollar', 'AUD'),
    ('Fr', 'Swiss Franc', 'CHF'),
    ('kr', 'Swedish Krona', 'SEK'),
    ('kr', 'Norwegian Krone', 'NOK'),
    ('kr', 'Danish Krone', 'DKK'),
    ('$', 'Singapore Dollar', 'SGD'),
    ('$', 'Hong Kong Dollar', 'HKD'),
    ('₩', 'South Korean Won', 'KRW'),
    ('$', 'New Zealand Dollar', 'NZD'),
    ('$', 'Mexican Peso', 'MXN'),
    ('R', 'South African Rand', 'ZAR'),
    ('R$', 'Brazilian Real', 'BRL'),
    ('руб', 'Russian Ruble', 'RUB'),
    ('zł', 'Polish Zloty', 'PLN'),
    ('Kč', 'Czech Koruna', 'CZK'),
    ('Ft', 'Hungarian Forint', 'HUF'),
    ('lei', 'Romanian Leu', 'RON'),
    ('₺', 'Turkish Lira', 'TRY'),
    ('Rp', 'Indonesian Rupiah', 'IDR'),
    ('₱', 'Philippine Peso', 'PHP'),
    ('฿', 'Thai Baht', 'THB'),
    ('RM', 'Malaysian Ringgit', 'MYR'),
    ('$', 'Chilean Peso', 'CLP'),
    ('$', 'Argentine Peso', 'ARS'),
    ('$', 'Colombian Peso', 'COP'),
    ('﷼', 'Saudi Riyal', 'SAR'),
    ('د.إ', 'UAE Dirham', 'AED'),
    ('₪', 'Israeli Shekel', 'ILS'),
    ('₨', 'Pakistani Rupee', 'PKR'),
    ('Tk', 'Bangladeshi Taka', 'BDT'),
    ('රු', 'Sri Lankan Rupee', 'LKR'),
    ('₦', 'Nigerian Naira', 'NGN'),
    ('KSh', 'Kenyan Shilling', 'KES'),
    ('E£', 'Egyptian Pound', 'EGP');

-- Create index for faster lookups
CREATE INDEX idx_currencies_abbreviation ON currencies(abbreviation);
