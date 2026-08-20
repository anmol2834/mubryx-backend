async function test2FactorOptions() {
  const apiKey = 'bc3bfaaa-97c5-11f1-9cb1-0200cd936042';
  const phone = '8264983605';
  
  // 1. Transactional API
  console.log('--- Testing Transactional API ---');
  const msgText = `Dear Customer, 123456 is your Mubryx Login verification code. Do not share OTP with anyone for account safety. Team Mubryx.`;
  const encodedMsg = encodeURIComponent(msgText);
  const transUrl = `https://2factor.in/API/R1/?module=TRANS_SMS&apikey=${apiKey}&to=${phone}&from=MUBRYX&msg=${encodedMsg}`;
  try {
    const res = await fetch(transUrl);
    const data = await res.text();
    console.log('Transactional Response:', data);
  } catch (error) {
    console.error('Transactional Error:', error);
  }

  // 2. Addon Services TSMS API
  console.log('\n--- Testing Addon TSMS API ---');
  const tsmsUrl = `https://2factor.in/API/V1/${apiKey}/ADDON_SERVICES/SEND/TSMS?From=MUBRYX&To=${phone}&Msg=${encodedMsg}`;
  try {
    const res = await fetch(tsmsUrl);
    const data = await res.json();
    console.log('TSMS Response:', data);
  } catch (error) {
    console.error('TSMS Error:', error);
  }
}

test2FactorOptions();
