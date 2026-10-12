const http = require('http');
require('dotenv').config();
const { generateToken } = require('./utils/tokenUtils');
const pool = require('./config/database');

async function test() {
  try {
    const adminUser = (await pool.query("SELECT id, email FROM public.users WHERE role = 'ADMIN' LIMIT 1")).rows[0];
    const token = generateToken({ userId: adminUser.id, email: adminUser.email, role: 'ADMIN' });
    
    function callApi(endpoint) {
      return new Promise((resolve) => {
        const req = http.request({
          hostname: 'localhost',
          port: 5000,
          path: endpoint,
          method: 'GET',
          headers: { Authorization: 'Bearer ' + token }
        }, (res) => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
        });
        req.end();
      });
    }

    const empRes = await callApi('/api/admin/employees/GP0001N');
    const bankRes = await callApi('/api/admin/employees/GP0001N/bank-details');

    console.log('EMP RES bank_details:', empRes.data.data?.bank_details);
    console.log('BANK RES data:', bankRes.data.data);
    pool.end();
  } catch (err) {
    console.error(err);
    pool.end();
  }
}
test();
