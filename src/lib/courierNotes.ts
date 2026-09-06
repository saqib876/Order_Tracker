/**
 * Courier ke un statuses ke liye tafseeli Note jo customer ko khud kuch
 * karna parta hai — UNDELIVERED / CONTACTING CONSIGNEE (rider ko call kar ke
 * re-attempt), aur return wale stages (advance payment ke sath resend).
 *
 * Ye matan bilkul waisa hi rakha gaya hai jaisa aap ne diya tha — is mein
 * apni marzi se lafz mat badalna, ye customer ko seedha jata hai.
 */

/**
 * UNDELIVERED aur CONTACTING CONSIGNEE dono ka note ek hi hai — sirf pehli
 * line mein status ka naam badalta hai.
 */
export function undeliveredNote(statusName: string, trackingId: string): string {
  return `Note: Ap ka Order ${statusName} show ho rha ha. Rider ap ko Parcel deny aya tha ap Available ni thi ap ny Call b Pick ni ki Rider ny Call ki thi or Courier khd b Auto Call krti ha.

Ap ko Courier ki trf sy Msg aya ho ga us Msg ma Rider ka Number dia hota ha. Kindly ap Rider ko Call kr lain or Parcel Redeliver krny ka kh dain.Rider ap ko again Parcel deny a jy ga. Courier k Auto msg ma Re-Attempt  ka b option hota ha wha sy b Re-Attempt  pr Click kr dain.

Agr ap ko Courier ka Msg ni ml rha ha ya Rider ka Number ni ml rha ha to ap Courier ki Helpline pr Call kr k Order delivery na hony kja issue poch skty ha or unhain Redelivery ka kh dain wo Update kr dain gy.

Your Order Tracking/CN Number : ${trackingId}
Courier Helpline: (042) 111 786 227
Courier Email ID: support@postex.pk

Hm ny apny end sy portal ma update kr dia ha. Re-Attempt ap Rider/Courier ko call kr k krwa lain.`
}

/**
 * MOVED TO ORIGIN / REACHED AT ORIGIN / OUT FOR RETURN SUBMISSION /
 * RETURNED SUBMITTED — parcel wapas aa raha hai.
 */
export const RETURNING_NOTE = `Note: Ap ka Parcel Return a rha ha Rider ny ap ko Call b ki thi ap ny Call Pick ni ki then Rider deny aya tha ap available ni thi. Then again Rider ap ko Parcel deny aya tha ap ny receive ni kia Return kr dia ha. 

Ap ko resend kr dain gy but us k lia ap ko Advance Payment Online krna ho gi.
Advance Online Payment sy ye Number ka ya Address ka issue ho jata ha to parcel Return ni ata ap k area ma Courier ki Branch ha wha pr chala jata ha or jb tk ap Receive ni krty ha wo ap ko deny k lia aty rhty ha.

New Order ap Cash on Delivery k sath Place ni kr skty Q k jo Parcel Return a jata ha jb tk Customer Old Order Advance Online Payment kr k Receive ni krta hm New Order k lia Cash on Delivery off kr deta ha.
Jb Customer Order Advance Online Payment kr k Old Order Receive kr leta ha then New Order k lia Cash on Delivery On ho jati ha .

Reason: Ap ka Order Print on Demand hota ha ReadyMade ni Specially ap k order krny pr bnta ha. Return hony pr 300 Dc hm pay krty ha Return Charges 400 hm pay krty ha or Agr  Customer Order Advance Online Payment kr k parcel receive ni krta to Product b Waste ho Jati ha or agr Order Advance Online Payment kr k receive kr leta ha tb b Hmara 300 Dc or 400 Return Charges -700 ka Lose ho chka hota ha jo hm 2nd time Delivery pr Customer sy ni lety ha khd Bear krty ha.`
