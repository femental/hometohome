export function Privacy() {
  return (
    <>
      <h2>1. Personal data we collect</h2>
      <p>We collect the minimum data needed to run bookings:</p>
      <ul>
        <li>Email address (for your account, sign-in links and booking emails)</li>
        <li>Name</li>
        <li>Nationality</li>
        <li>Gender (some rooms have a gender policy)</li>
        <li>Contact information (for example, a phone number or messenger ID)</li>
        <li>The message you write in your booking request</li>
      </ul>
      <p>
        Payment is processed by our payment provider. We do not store full card numbers; we keep
        only payment results (amount, currency, status, transaction identifiers).
      </p>

      <h2>2. Why we use it</h2>
      <ul>
        <li>To identify you and manage your account.</li>
        <li>To process booking requests, payments, cancellations and refunds.</li>
        <li>To contact you about your booking and to arrange check-in.</li>
        <li>To handle inquiries and disputes, and to meet legal obligations.</li>
      </ul>

      <h2>3. Retention</h2>
      <p>
        We keep personal data while your account is active and for the period required by law
        afterwards (for example, records of contracts, payments and withdrawals under the Act on the
        Consumer Protection in Electronic Commerce are kept for 5 years). After that it is deleted.
      </p>

      <h2>4. Sharing and processors</h2>
      <p>
        We do not sell personal data. We use service providers to operate the Service: hosting and
        database (Vercel, Supabase), email delivery (Resend), payment processing (our payment
        provider and PayPal), and maps (Google). Data may therefore be processed outside Korea.
        Booking details are shared with the host or property manager only as needed for your stay.
      </p>

      <h2>5. Your rights</h2>
      <p>
        You may request access to, correction of, or deletion of your personal data, and withdraw
        consent, by contacting us using the details in the footer. Deletion may be limited where law
        requires us to keep records.
      </p>

      <h2>6. Security</h2>
      <p>
        Data is stored with access controls, transmitted over encrypted connections, and available
        only to authorised staff.
      </p>

      <h2>7. Contact</h2>
      <p>For privacy questions, use the contact details shown in the footer.</p>
    </>
  );
}
