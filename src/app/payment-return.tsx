import { Redirect } from 'expo-router';

/**
 * bKash sends the browser back to turfsides://payment-return. Checkout normally
 * catches that inside its auth session; if the OS opens the link directly instead,
 * land on bookings — the payment itself is confirmed by the server, never by this link.
 */
export default function PaymentReturn() {
  return <Redirect href="/bookings" />;
}
