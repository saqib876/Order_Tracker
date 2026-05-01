/**
 * Returns the CallCourier tracking page URL for a given tracking number.
 * Customers are redirected to this URL to track their shipment.
 */
export function getPostExTrackingUrl(trackingId: string): string {
  return `https://callcourier.com.pk/tracking`
}
