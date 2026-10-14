-- =============================================================================
-- Database Schema: employee_portal
-- Central Entity: employees (PRIMARY KEY: employee_id VARCHAR(20))
-- PostgreSQL Version: 18.x
-- =============================================================================

-- Enable pgcrypto if needed (gen_random_uuid is core in PG 13+)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Clean up existing objects if any (for fresh, repeatable initialization)
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS otp_verifications CASCADE;
DROP TABLE IF EXISTS payroll_records CASCADE;
DROP TABLE IF EXISTS payroll_profiles CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS attendance CASCADE;
DROP TABLE IF EXISTS leave_requests CASCADE;
DROP TABLE IF EXISTS leave_balances CASCADE;
DROP TABLE IF EXISTS pf_details CASCADE;
DROP TABLE IF EXISTS employees CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- -----------------------------------------------------------------------------
-- 1. USERS TABLE
-- Authentication identity and role
-- -----------------------------------------------------------------------------
CREATE TABLE users (
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
-- Central organization employee entity.
-- Authoritative primary key is the organization-assigned employee_id (e.g. GP0001N).
-- -----------------------------------------------------------------------------
CREATE TABLE employees (
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

-- Establish foreign key from users.employee_id -> employees.employee_id
-- (Added after employees table exists to cleanly resolve circular dependencies)
ALTER TABLE users
    ADD CONSTRAINT fk_users_employee_id
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id)
    ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 3. PF_DETAILS TABLE
-- Provident fund and pension details linked to employee_id
-- -----------------------------------------------------------------------------
CREATE TABLE pf_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(20) UNIQUE NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    uan_number VARCHAR(50),
    pf_number VARCHAR(50),
    pension_number VARCHAR(50),
    employee_contribution NUMERIC(12, 2),
    employer_contribution NUMERIC(12, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. LEAVE_BALANCES TABLE
-- Annual leave allocations and balances per employee
-- -----------------------------------------------------------------------------
CREATE TABLE leave_balances (
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
CREATE TABLE leave_requests (
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
-- UNIQUE(employee_id, attendance_date) prevents duplicate entries for the same date.
-- -----------------------------------------------------------------------------
CREATE TABLE attendance (
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
-- Stores storage keys instead of public URLs for security.
-- -----------------------------------------------------------------------------
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(20) NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    document_type VARCHAR(100) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    storage_key TEXT NOT NULL,
    month INTEGER,
    year INTEGER,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 8. PAYROLL_PROFILES TABLE
-- Salary structure and recurring deduction definitions per employee
-- -----------------------------------------------------------------------------
CREATE TABLE payroll_profiles (
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
-- 9. PAYROLL_RECORDS TABLE
-- Monthly processed payslips and salary payouts
-- UNIQUE(employee_id, month, year) prevents multiple payouts for the same month.
-- -----------------------------------------------------------------------------
CREATE TABLE payroll_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(20) NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
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

-- -----------------------------------------------------------------------------
-- 10. OTP_VERIFICATIONS TABLE
-- Ephemeral OTP codes for secure authentication/verification.
-- Plaintext OTP is NEVER stored (only hashed value).
-- -----------------------------------------------------------------------------
CREATE TABLE otp_verifications (
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
-- Immutable system action logs for compliance and debugging
-- -----------------------------------------------------------------------------
CREATE TABLE audit_logs (
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
-- INDEXES FOR PERFORMANCE AND OPTIMIZATION
-- -----------------------------------------------------------------------------
-- Users indexes
CREATE INDEX idx_users_employee_id ON users(employee_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);

-- Employees indexes
CREATE INDEX idx_employees_user_id ON employees(user_id);
CREATE INDEX idx_employees_email ON employees(email);
CREATE INDEX idx_employees_department ON employees(department);
CREATE INDEX idx_employees_status ON employees(status);

-- Leave requests indexes
CREATE INDEX idx_leave_requests_employee_id ON leave_requests(employee_id);
CREATE INDEX idx_leave_requests_status ON leave_requests(status);
CREATE INDEX idx_leave_requests_dates ON leave_requests(employee_id, start_date, end_date);

-- Attendance indexes
CREATE INDEX idx_attendance_employee_id ON attendance(employee_id);
CREATE INDEX idx_attendance_date ON attendance(attendance_date);
CREATE INDEX idx_attendance_status ON attendance(status);

-- Documents indexes
CREATE INDEX idx_documents_employee_id ON documents(employee_id);
CREATE INDEX idx_documents_type_period ON documents(employee_id, document_type, year, month);

-- Payroll records indexes
CREATE INDEX idx_payroll_records_employee_id ON payroll_records(employee_id);
CREATE INDEX idx_payroll_records_period ON payroll_records(year, month);
CREATE INDEX idx_payroll_records_status ON payroll_records(status);

-- OTP verifications indexes
CREATE INDEX idx_otp_verifications_email ON otp_verifications(email);
CREATE INDEX idx_otp_verifications_user_id ON otp_verifications(user_id);
CREATE INDEX idx_otp_verifications_expires_at ON otp_verifications(expires_at);

-- Audit logs indexes
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- -----------------------------------------------------------------------------
-- 12. ANNOUNCEMENTS TABLE (Phase 17)
-- -----------------------------------------------------------------------------
CREATE TABLE announcements (
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 13. ANNOUNCEMENT_READS TABLE (Phase 17)
-- -----------------------------------------------------------------------------
CREATE TABLE announcement_reads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    employee_id VARCHAR(20) NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_announcement_employee_read UNIQUE (announcement_id, employee_id)
);

-- Announcements indexes
CREATE INDEX idx_announcements_status ON announcements(status);
CREATE INDEX idx_announcements_publish_at ON announcements(publish_at);
CREATE INDEX idx_announcements_target_type ON announcements(target_type);
CREATE INDEX idx_announcements_target_department ON announcements(target_department);
CREATE INDEX idx_announcements_target_employee_id ON announcements(target_employee_id);

-- Announcement reads indexes
CREATE INDEX idx_announcement_reads_employee_id ON announcement_reads(employee_id);
CREATE INDEX idx_announcement_reads_announcement_id ON announcement_reads(announcement_id);

-- -----------------------------------------------------------------------------
-- 14. STATUTORY PAYROLL ARCHIVE TABLE (8-Year Compliance Retention)
-- Preserves legally mandated payroll and tax records for deleted employees
-- Under Indian Income Tax Act 1961 Section 44AA and EPF Act 1952
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS statutory_payroll_archive (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_payroll_id UUID NOT NULL,
    employee_id VARCHAR(50) NOT NULL,
    employee_name VARCHAR(255),
    designation VARCHAR(100),
    department VARCHAR(100),
    month VARCHAR(20) NOT NULL,
    year INTEGER NOT NULL,
    total_days INTEGER,
    working_days INTEGER,
    paid_days NUMERIC(5,2),
    loss_of_pay_days NUMERIC(5,2),
    gross_earnings NUMERIC(12,2) NOT NULL,
    total_deductions NUMERIC(12,2) NOT NULL,
    net_salary NUMERIC(12,2) NOT NULL,
    statutory_details JSONB,
    deductions_breakdown JSONB,
    earnings_breakdown JSONB,
    retention_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '8 years'),
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_by UUID REFERENCES users(id) ON DELETE SET NULL,
    deletion_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_statutory_payroll_archive_emp ON statutory_payroll_archive(employee_id);
CREATE INDEX IF NOT EXISTS idx_statutory_payroll_archive_retention ON statutory_payroll_archive(retention_until);


