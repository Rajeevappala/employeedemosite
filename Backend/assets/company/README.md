# Company Authorization Assets

This secure, server-side directory stores official authorization graphics used exclusively by the automated payslip PDF generation service (`Backend/services/payslipPdfService.js`).

> **Security Note:** This folder is strictly internal to the backend server and is NOT exposed through any public static routes.

## Required Assets

1. **`signatory_signature.png`**
   - **Purpose:** Official authorized company signatory signature.
   - **Recommended Format:** Transparent PNG.
   - **Recommended Dimensions:** ~300 x 120 pixels (high resolution).
   - **Environment Variable Override:** `COMPANY_SIGNATURE_PATH` in `.env`

2. **`office_stamp.png`**
   - **Purpose:** Official GaintPro Software Technologies office seal / stamp.
   - **Recommended Format:** Transparent PNG.
   - **Recommended Dimensions:** ~200 x 200 pixels (high resolution).
   - **Environment Variable Override:** `COMPANY_STAMP_PATH` in `.env`

## Behavior
- When genuine assets are placed here, the PDF generator will automatically scale them maintaining exact aspect ratios and position them neatly side-by-side in the authorization area of every payslip.
- If assets are missing and official payslip generation is requested with `PAYSLIP_REQUIRE_ASSETS=true`, generation will safely fail with HTTP 422 and a clear message informing the Admin that genuine assets are missing.
- To preview the PDF layout geometry without real assets, use the preview endpoint (`GET /api/admin/payroll/preview-payslip-pdf`).
