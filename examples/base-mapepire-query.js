/**
 * Pool query example using the base Mapepire JS client.
 */

const mapepire = require("@ibm/mapepire-js");

async function main() {
  const creds = {
    host: 'myibmi.com',
    user: 'MYUSER',
    password: 'MYPASSWORD',
    rejectUnauthorized: false
  }

  const pool = new mapepire.Pool({creds, maxSize: 2, startingSize: 1});
  await pool.init();

  const result = await pool.execute('SELECT * FROM QIWS.QCUSTCDT');

  console.dir(result,{depth:5});

  await pool.end();
}

main().catch(console.error);