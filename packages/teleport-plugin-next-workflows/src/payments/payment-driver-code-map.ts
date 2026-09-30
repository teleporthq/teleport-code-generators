import type { PaymentDriverId } from './payment-drivers-scope'
import { generateStripeDriverCode } from './drivers/stripe-driver-code'
import { generatePaypalDriverCode } from './drivers/paypal-driver-code'
import { generateMollieDriverCode } from './drivers/mollie-driver-code'
import { generateRazorpayDriverCode } from './drivers/razorpay-driver-code'
import { generateSquareDriverCode } from './drivers/square-driver-code'
import { generatePaddleDriverCode } from './drivers/paddle-driver-code'
import { generateCoingateDriverCode } from './drivers/coingate-driver-code'

/** The module source of each provider's driver (`utils/payments/drivers/<id>.js`). */
export const PAYMENT_DRIVER_CODE: Record<PaymentDriverId, () => string> = {
  stripe: generateStripeDriverCode,
  paypal: generatePaypalDriverCode,
  mollie: generateMollieDriverCode,
  razorpay: generateRazorpayDriverCode,
  square: generateSquareDriverCode,
  paddle: generatePaddleDriverCode,
  coingate: generateCoingateDriverCode,
}
