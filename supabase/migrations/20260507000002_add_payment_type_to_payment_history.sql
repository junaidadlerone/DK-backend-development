ALTER TABLE payment_history ADD COLUMN IF NOT EXISTS payment_type TEXT;

COMMENT ON COLUMN payment_history.payment_type IS 'Type of charge: postcard_sending, address_verification, or NULL for legacy records';
