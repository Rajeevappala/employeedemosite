-- =============================================================================
-- GaintPro HRM Portal - Consolidated Production Database Schema
-- Target: PostgreSQL 14+
-- Safety Guarantee: Non-destructive, idempotent (no DROP TABLE, no TRUNCATE)
-- Safe to execute on both fresh and pre-existing databases.
-- =============================================================================

-- Enable pgcrypto extension for UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. USERS TABLE
-- Authentication identities and role-based access control
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id VARCHAR(50) UNIQUE NULL,
    employee_id VARCHAR(20) NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(30) NOT NULL CHECK (role IN ('EMPLOYEE', 'ADMIN')),
    status VARCHAR(30) NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    first_name VARCHAR(100) NULL,
    last_name VARCHAR(100) NULL,
    phone VARCHAR(30) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. EMPLOYEES TABLE
-- Central organization employee directory and employment details
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
    employee_id VARCHAR(20) PRIMARY KEY,
    user_id UUID UNIQUE NULL REFERENCES users(id) ON DELETE SET NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(30),
    date_of_birth DATE,
    gender VARCHAR(30),
    department VARCHAR(100),
    designation VARCHAR(150),
    date_of_joining DATE,
    reporting_manager VARCHAR(150),
    employment_type VARCHAR(50),
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    emergency_contact_name VARCHAR(150),
    emergency_contact_phone VARCHAR(30),
    personal_email VARCHAR(255),
    emergency_contact_relationship VARCHAR(100),
    work_location VARCHAR(150),
    working_days_per_week INTEGER NOT NULL DEFAULT 5 CHECK (working_days_per_week IN (5, 6)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safe idempotent addition of circular FK: users.employee_id -> employees.employee_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_employee_id'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT fk_users_employee_id
            FOREIGN KEY (employee_id) REFERENCES employees(employee_id)
            ON DELETE SET NULL;
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. PF_DETAILS TABLE
-- Provident Fund and statutory pension details
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pf_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(20) UNIQUE NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    uan_number VARCHAR(50),
    pf_number VARCHAR(50),
    pension_number VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. LEAVE_BALANCES TABLE
-- Annual employee leave allotments and current balances
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(20) UNIQUE NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    paid_leave_balance NUMERIC(8, 2) NOT NULL DEFAULT 0,
    sick_leave_balance NUMERIC(8, 2) NOT NULL DEFAULT 0,
    unpaid_leave_balance NUMERIC(8, 2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 5. LEAVE_REQUESTS TABLE
-- Employee leave applications and approval workflows
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(20) NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    leave_type VARCHAR(30) NOT NULL CHECK (leave_type IN ('PL', 'UPL', 'Sick Leave')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days NUMERIC(6, 2) NOT NULL,
    reason TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
    admin_comment TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 6. ATTENDANCE TABLE
-- Daily employee attendance records
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(20) NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL CHECK (status IN ('Present', 'Absent', 'Half Day', 'Leave', 'Holiday', 'Work From Home', 'Week Off')),
    remarks TEXT,
    marked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_attendance_employee_date UNIQUE (employee_id, attendance_date)
);

-- -----------------------------------------------------------------------------
-- 7. DOCUMENTS TABLE
-- Employee uploaded / assigned files (payslips, tax forms, IDs, etc.)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(20) NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    document_type VARCHAR(100) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    storage_key TEXT NOT NULL,
    month INTEGER,
    year INTEGER,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    release_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    exit_request_id UUID REFERENCES exit_requests(id) ON DELETE SET NULL,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 8. PAYROLL_PROFILES TABLE
-- Salary structure and recurring deduction definitions per employee
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(20) UNIQUE NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    basic_salary NUMERIC(12, 2) NOT NULL DEFAULT 0,
    hra NUMERIC(12, 2) NOT NULL DEFAULT 0,
    allowances NUMERIC(12, 2) NOT NULL DEFAULT 0,
    pf_employee NUMERIC(12, 2) NOT NULL DEFAULT 0,
    professional_tax NUMERIC(12, 2) NOT NULL DEFAULT 0,
    other_deductions NUMERIC(12, 2) NOT NULL DEFAULT 0,
    effective_from DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 8b. PAYROLL_BATCHES TABLE
-- Tracks payroll batch import, validation, confirmation, and payslip generation workflow
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number VARCHAR(50) UNIQUE NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'Uploaded',
    total_records INTEGER NOT NULL DEFAULT 0,
    valid_records INTEGER NOT NULL DEFAULT 0,
    invalid_records INTEGER NOT NULL DEFAULT 0,
    processed_records INTEGER NOT NULL DEFAULT 0,
    payslips_generated INTEGER NOT NULL DEFAULT 0,
    payslips_failed INTEGER NOT NULL DEFAULT 0,
    total_gross_salary NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_deductions NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_net_salary NUMERIC(14, 2) NOT NULL DEFAULT 0,
    file_name VARCHAR(255),
    error_summary JSONB DEFAULT '[]'::jsonb,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 9. PAYROLL_RECORDS TABLE
-- Monthly processed payslips and salary payouts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(20) NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    batch_id UUID REFERENCES payroll_batches(id) ON DELETE SET NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    working_days NUMERIC(6, 2),
    payable_days NUMERIC(6, 2),
    basic_salary NUMERIC(12, 2),
    hra NUMERIC(12, 2),
    allowances NUMERIC(12, 2),
    gross_salary NUMERIC(12, 2),
    pf_employee NUMERIC(12, 2),
    professional_tax NUMERIC(12, 2),
    other_deductions NUMERIC(12, 2),
    total_deductions NUMERIC(12, 2),
    net_salary NUMERIC(12, 2),
    status VARCHAR(30),
    processed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payroll_records_employee_month_year UNIQUE (employee_id, month, year)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_employee_payslip_period
ON documents (employee_id, month, year)
WHERE LOWER(document_type) = 'payslip';


-- -----------------------------------------------------------------------------
-- 10. OTP_VERIFICATIONS TABLE
-- Ephemeral OTP codes for secure authentication/verification
-- Plaintext OTP is NEVER stored (only hashed value)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    otp_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 11. AUDIT_LOGS TABLE
-- Immutable system action logs for compliance and traceability
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id VARCHAR(100),
    metadata JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 12. ANNOUNCEMENTS TABLE
-- Broadcast messages and organizational announcements
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal', 'High', 'Urgent')),
    target_type VARCHAR(30) NOT NULL DEFAULT 'ALL' CHECK (target_type IN ('ALL', 'DEPARTMENT', 'EMPLOYEE')),
    target_department VARCHAR(100) NULL,
    target_employee_id VARCHAR(20) NULL REFERENCES employees(employee_id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    publish_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 13. ANNOUNCEMENT_READS TABLE
-- Tracks announcement read/acknowledgment status per employee
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcement_reads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    employee_id VARCHAR(20) NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_announcement_employee_read UNIQUE (announcement_id, employee_id)
);

-- -----------------------------------------------------------------------------
-- 14. EXIT_REQUESTS TABLE
-- Resignation requests and separation workflow tracking
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exit_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(20) NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    resignation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    requested_relieving_date DATE NOT NULL,
    approved_relieving_date DATE,
    reason TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED' 
        CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'COMPLETED')),
    admin_remarks TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 15. EXIT_CLEARANCES TABLE
-- Multi-department offboarding clearance signoffs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exit_clearances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exit_request_id UUID NOT NULL REFERENCES exit_requests(id) ON DELETE CASCADE,
    department VARCHAR(50) NOT NULL 
        CHECK (department IN ('IT', 'FINANCE', 'HR', 'DEPARTMENT_HEAD')),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' 
        CHECK (status IN ('PENDING', 'CLEARED', 'REJECTED', 'WAIVED')),
    remarks TEXT,
    cleared_by UUID REFERENCES users(id) ON DELETE SET NULL,
    cleared_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_exit_clearance_request_dept UNIQUE (exit_request_id, department)
);

-- -----------------------------------------------------------------------------
-- 16. FNF_SETTLEMENTS TABLE
-- Final settlement calculations, encashment, recoveries, and documents
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fnf_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exit_request_id UUID UNIQUE NOT NULL REFERENCES exit_requests(id) ON DELETE CASCADE,
    employee_id VARCHAR(20) NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    working_days NUMERIC(6, 2) NOT NULL DEFAULT 30,
    payable_days NUMERIC(6, 2) NOT NULL DEFAULT 0,
    prorated_salary NUMERIC(12, 2) NOT NULL DEFAULT 0,
    encashed_leave_days NUMERIC(6, 2) NOT NULL DEFAULT 0,
    leave_encashment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    gratuity_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    bonus_or_incentive NUMERIC(12, 2) NOT NULL DEFAULT 0,
    notice_period_recovery NUMERIC(12, 2) NOT NULL DEFAULT 0,
    other_deductions NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_earnings NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_deductions NUMERIC(12, 2) NOT NULL DEFAULT 0,
    net_payable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    settlement_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    relieving_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    experience_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' 
        CHECK (status IN ('DRAFT', 'FINALIZED')),
    finalized_by UUID REFERENCES users(id) ON DELETE SET NULL,
    finalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- PERFORMANCE AND CONSTRAINT INDEXES (IDEMPOTENT)
-- -----------------------------------------------------------------------------
-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Employees indexes
CREATE INDEX IF NOT EXISTS idx_employees_user_id ON employees(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

-- Leave requests indexes
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_id ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(employee_id, start_date, end_date);

-- Attendance indexes
CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON attendance(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);

-- Documents indexes
CREATE INDEX IF NOT EXISTS idx_documents_employee_id ON documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_documents_type_period ON documents(employee_id, document_type, year, month);

-- Payroll records indexes
CREATE INDEX IF NOT EXISTS idx_payroll_records_employee_id ON payroll_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_records_period ON payroll_records(year, month);
CREATE INDEX IF NOT EXISTS idx_payroll_records_status ON payroll_records(status);

-- OTP verifications indexes
CREATE INDEX IF NOT EXISTS idx_otp_verifications_email ON otp_verifications(email);
CREATE INDEX IF NOT EXISTS idx_otp_verifications_user_id ON otp_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_verifications_expires_at ON otp_verifications(expires_at);

-- Audit logs indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Announcements indexes
CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcements_publish_at ON announcements(publish_at);
CREATE INDEX IF NOT EXISTS idx_announcements_target_type ON announcements(target_type);
CREATE INDEX IF NOT EXISTS idx_announcements_target_department ON announcements(target_department);
CREATE INDEX IF NOT EXISTS idx_announcements_target_employee_id ON announcements(target_employee_id);

-- Announcement reads indexes
CREATE INDEX IF NOT EXISTS idx_announcement_reads_employee_id ON announcement_reads(employee_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement_id ON announcement_reads(announcement_id);

-- Exit requests indexes & partial unique index (only one active exit request per employee)
CREATE INDEX IF NOT EXISTS idx_exit_requests_employee_id ON exit_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_exit_requests_status ON exit_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_exit_request ON exit_requests(employee_id)
    WHERE status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED');

-- Exit clearances indexes
CREATE INDEX IF NOT EXISTS idx_exit_clearances_request_id ON exit_clearances(exit_request_id);
CREATE INDEX IF NOT EXISTS idx_exit_clearances_status ON exit_clearances(status);

-- FNF settlements indexes
CREATE INDEX IF NOT EXISTS idx_fnf_settlements_employee_id ON fnf_settlements(employee_id);
CREATE INDEX IF NOT EXISTS idx_fnf_settlements_status ON fnf_settlements(status);

-- Exit workflow document columns idempotent migration
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS release_date DATE;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS exit_request_id UUID REFERENCES exit_requests(id) ON DELETE SET NULL;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS remarks TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_release_date ON documents(release_date);
CREATE INDEX IF NOT EXISTS idx_documents_exit_request ON documents(exit_request_id);
CREATE INDEX IF NOT EXISTS idx_documents_is_active ON documents(is_active);

-- -----------------------------------------------------------------------------
-- 15. ORGANIZATION_SETTINGS TABLE
-- Central organization-wide profile and configuration (singleton)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(200),
    address_line_1 TEXT,
    address_line_2 TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) NOT NULL DEFAULT 'India',
    phone VARCHAR(50),
    email VARCHAR(255),
    website VARCHAR(255),
    logo_path TEXT,
    is_singleton BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_organization_settings_singleton UNIQUE (is_singleton),
    CONSTRAINT chk_organization_settings_singleton_true CHECK (is_singleton IS TRUE)
);

CREATE INDEX IF NOT EXISTS idx_organization_settings_updated_at ON organization_settings(updated_at);

-- Seed default organization settings record if not present
INSERT INTO organization_settings (organization_name, country)
VALUES ('GaintPro Software Technologies', 'India')
ON CONFLICT (is_singleton) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 16. ORGANIZATION_WORK_SETTINGS TABLE
-- Central organization-wide work schedules and attendance rules (singleton)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_work_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    default_work_week VARCHAR(30) NOT NULL DEFAULT '5-Day Work Week',
    default_work_start_time TIME NOT NULL DEFAULT '09:30:00',
    default_work_end_time TIME NOT NULL DEFAULT '18:30:00',
    default_break_duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (default_break_duration_minutes >= 0 AND default_break_duration_minutes <= 480),
    default_weekly_off_days JSONB NOT NULL DEFAULT '["Saturday", "Sunday"]'::jsonb,
    allow_half_day BOOLEAN NOT NULL DEFAULT TRUE,
    allow_work_from_home BOOLEAN NOT NULL DEFAULT TRUE,
    is_singleton BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_org_work_settings_singleton UNIQUE (is_singleton),
    CONSTRAINT chk_org_work_settings_singleton_true CHECK (is_singleton IS TRUE)
);

CREATE INDEX IF NOT EXISTS idx_org_work_settings_updated_at ON organization_work_settings(updated_at);

-- Seed default configuration record if not present
INSERT INTO organization_work_settings (
    default_work_week,
    default_work_start_time,
    default_work_end_time,
    default_break_duration_minutes,
    default_weekly_off_days,
    allow_half_day,
    allow_work_from_home
) VALUES (
    '5-Day Work Week',
    '09:30:00',
    '18:30:00',
    60,
    '["Saturday", "Sunday"]'::jsonb,
    TRUE,
    TRUE
)
ON CONFLICT (is_singleton) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 17. ORGANIZATION_LEAVE_SETTINGS TABLE
-- Central organization-wide leave policies and allocation defaults (singleton)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_leave_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    default_annual_paid_leave INTEGER NOT NULL DEFAULT 18 CHECK (default_annual_paid_leave >= 0),
    default_annual_sick_leave INTEGER NOT NULL DEFAULT 10 CHECK (default_annual_sick_leave >= 0),
    default_annual_unpaid_leave INTEGER NOT NULL DEFAULT 0 CHECK (default_annual_unpaid_leave >= 0),
    allow_carry_forward BOOLEAN NOT NULL DEFAULT TRUE,
    max_carry_forward_days INTEGER NOT NULL DEFAULT 5 CHECK (max_carry_forward_days >= 0),
    allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE,
    require_admin_approval BOOLEAN NOT NULL DEFAULT TRUE,
    minimum_leave_notice_days INTEGER NOT NULL DEFAULT 1 CHECK (minimum_leave_notice_days >= 0),
    maximum_continuous_leave_days INTEGER NOT NULL DEFAULT 14 CHECK (maximum_continuous_leave_days > 0),
    is_singleton BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_org_leave_settings_singleton UNIQUE (is_singleton),
    CONSTRAINT chk_org_leave_settings_singleton_true CHECK (is_singleton IS TRUE)
);

CREATE INDEX IF NOT EXISTS idx_org_leave_settings_updated_at ON organization_leave_settings(updated_at);

-- Seed default configuration record if not present
INSERT INTO organization_leave_settings (
    default_annual_paid_leave,
    default_annual_sick_leave,
    default_annual_unpaid_leave,
    allow_carry_forward,
    max_carry_forward_days,
    allow_negative_balance,
    require_admin_approval,
    minimum_leave_notice_days,
    maximum_continuous_leave_days
) VALUES (
    18,
    10,
    0,
    TRUE,
    5,
    FALSE,
    TRUE,
    1,
    14
)
ON CONFLICT (is_singleton) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 18. ORGANIZATION_HOLIDAYS TABLE
-- Central organization-wide holiday calendar definitions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    holiday_date DATE NOT NULL,
    holiday_name VARCHAR(200) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_organization_holidays_date UNIQUE (holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_organization_holidays_date ON organization_holidays(holiday_date);
CREATE INDEX IF NOT EXISTS idx_organization_holidays_created_at ON organization_holidays(created_at);

-- -----------------------------------------------------------------------------
-- 19. EMPLOYEE CONFIGURATION MASTER DATA TABLES
-- Controlled master data for departments, designations, employment types, locations
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_departments_name_lower ON organization_departments (LOWER(TRIM(name)));

CREATE TABLE IF NOT EXISTS organization_designations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_designations_name_lower ON organization_designations (LOWER(TRIM(name)));

CREATE TABLE IF NOT EXISTS organization_employment_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_employment_types_name_lower ON organization_employment_types (LOWER(TRIM(name)));

CREATE TABLE IF NOT EXISTS organization_work_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100) DEFAULT 'India',
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_work_locations_name_lower ON organization_work_locations (LOWER(TRIM(name)));

-- -----------------------------------------------------------------------------
-- EMPLOYEE BANK DETAILS TABLE
-- Secure employee bank account information for salary processing
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_bank_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(20) UNIQUE NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
    account_holder_name VARCHAR(255) NOT NULL,
    bank_name VARCHAR(100) NOT NULL,
    account_number_encrypted TEXT NOT NULL,
    account_number_last4 VARCHAR(4) NOT NULL,
    ifsc_code VARCHAR(20) NOT NULL,
    branch_name VARCHAR(150),
    branch_city VARCHAR(100),
    branch_state VARCHAR(100),
    account_type VARCHAR(50) NOT NULL DEFAULT 'Savings',
    verification_status VARCHAR(30) NOT NULL DEFAULT 'Pending' CHECK (verification_status IN ('Pending', 'Verified', 'Rejected')),
    admin_remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_bank_details_employee_id 
    ON public.employee_bank_details(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_bank_details_verification_status 
    ON public.employee_bank_details(verification_status);

-- -----------------------------------------------------------------------------
-- 23. STATUTORY PAYROLL ARCHIVE TABLE
-- Retains legally required payroll records (8-year retention policy) after employee account deletion
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.statutory_payroll_archive (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_payroll_id UUID,
    employee_id VARCHAR(50),
    month VARCHAR(20),
    year INTEGER,
    basic_salary NUMERIC(12, 2),
    hra NUMERIC(12, 2),
    allowances NUMERIC(12, 2),
    gross_salary NUMERIC(12, 2),
    pf_employee NUMERIC(12, 2),
    professional_tax NUMERIC(12, 2),
    other_deductions NUMERIC(12, 2),
    total_deductions NUMERIC(12, 2),
    net_salary NUMERIC(12, 2),
    processed_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retention_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '8 years')
);

CREATE INDEX IF NOT EXISTS idx_statutory_payroll_archive_emp 
    ON public.statutory_payroll_archive(employee_id);
