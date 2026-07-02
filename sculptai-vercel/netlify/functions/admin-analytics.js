const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { access_token } = JSON.parse(event.body || "{}");

    // Verify the caller is an authenticated admin via Supabase Auth
    const verifyRes = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/user`,
      { headers: { Authorization: `Bearer ${access_token}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY } }
    );
    if (!verifyRes.ok) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
    }
    const user = await verifyRes.json();
    // Only allow admin email
    if (user.email !== "admin@sculptai.health") {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Forbidden" }) };
    }

    // Fetch all patients using service role key (bypasses RLS)
    const patientsRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/patients?select=id,doctor_id,created_at,risk_score,segment,outcome_procedures,no_appointment,had_procedure,satisfaction_1m,satisfaction_6m,answers&order=created_at.desc&limit=5000`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    const patients = await patientsRes.json();

    // Fetch doctors
    const doctorsRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/doctors?select=id,name,clinic_name`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    const doctors = await doctorsRes.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ patients: Array.isArray(patients) ? patients : [], doctors: Array.isArray(doctors) ? doctors : [] }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export { handler };
