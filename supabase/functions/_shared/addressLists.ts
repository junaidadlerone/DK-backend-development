export interface AddressRow {
    id: string;
    address_line1: string;
    address_line2?: string;
    city: string;
    state: string;
    zip: string;
    country?: string;
    status: "valid" | "invalid" | "duplicate";
    is_valid: boolean;
    is_duplicate: boolean;
    is_included: boolean;
    lat?: number;
    long?: number;
    error_message?: string;
}

export interface AddressListMetadata {
    total_rows?: number;
    valid_count?: number;
    invalid_count?: number;
    duplicate_count?: number;
    removed_count?: number;
    last_operation?: string;
    last_validation_batch_size?: number;
    [key: string]: string | number | boolean | undefined | null;
}

export interface AddressList {
    id: string;
    organization_id: string;
    campaign_id?: string;
    list_name: string;
    original_filename?: string;
    addresses: AddressRow[];
    metadata: AddressListMetadata;
    created_at: string;
    updated_at: string;
}
