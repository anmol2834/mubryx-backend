async function testNewlines() {
  const msg = `Dear Customer, 123456 is your Mubryx Login verification code.

Do not share OTP with anyone for account safety.

Team Mubryx.`;
  const url = `https://2factor.in/API/R1/?module=TRANS_SMS&apikey=bc3bfaaa-97c5-11f1-9cb1-0200cd936042&to=8264983605&from=MUBRYX&templatename=Customer%20Login&msg=${encodeURIComponent(msg)}`;
  try {
    const res = await fetch(url);
    console.log(await res.text());
  } catch (e) {
    console.log(e);
  }
}
testNewlines();
