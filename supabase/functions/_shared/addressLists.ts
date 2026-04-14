export interface AddressRow {
    id?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    address?: string; // Full address string used by location_zones and validated_address_list
    status?: string | "valid" | "invalid" | "duplicate";
    is_valid?: boolean;
    is_duplicate?: boolean;
    is_included?: boolean;
    is_deleted?: boolean;
    lat?: number;
    long?: number;
    error_message?: string;
    verified?: boolean; // PostGrid verification status
    verification_details?: Record<string, unknown>; // Detailed PostGrid response
    full_name?: string; // Optional recipient name
    first_name?: string;
    last_name?: string;
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

export interface ValidatedAddress {
    id?: string;
    row_id?: string;
    lat: number;
    long: number;
    osm_id: string | null;
    status: string;
    address: string;
    verified: boolean;
    zoneType: string;
    createdBy: {
        id: string;
        full_name: string | null;
        user_role: string | null;
        created_at: string;
        updated_at: string;
    } | null;
    residential: boolean;
    propertyType: string;
    building_type: string | null;
    postcards_sent: number;
    original_address: string;
    campaigns_used_in: string[];
    distanceFromCenter: number;
    targeting_zone_name: string;
    verification_details: {
        city: string;
        line1: string;
        status: string;
        details: Record<string, unknown>;
        postalOrZip: string;
        provinceOrState: string;
    };
    first_post_card_sent_date: string | null;
}

export interface AddressList {
    id: string;
    organization_id: string;
    campaign_id?: string;
    list_name: string;
    original_filename?: string;
    addresses: AddressRow[];
    validated_address_list?: ValidatedAddress[];
    metadata: AddressListMetadata;
    created_at: string;
    updated_at: string;
}
