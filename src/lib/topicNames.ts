/**
 * Wo topics jinhein CODE khud bulata hai (naam se).
 *
 * Aam topics customer ke alfaz se match hote hain. Ye do alag hain — bot
 * inhein ek khaas mauqe par apni marzi se bhejta hai, is liye naam ka
 * theek hona zaroori hai.
 *
 * Naam badlein to Vercel mein wohi naam laga dein; code chhune ki zaroorat
 * nahi. Sehat ka safha bata deta hai ke dono naam mil rahe hain ya nahi.
 */

/**
 * "Yes Available" ke sath jo guide jati hai (deal, product info, order
 * karne ka tareeqa). Pehle ye "Salaam / Greeting" se aati thi.
 */
export const MODEL_GUIDE_TOPIC =
  process.env.MODEL_GUIDE_TOPIC || 'Buy 1 Get 1 Offer / Product Info Chahiye / How To Place Order'

/**
 * Sawaal order tracking ka ho, lekin bot ko order mila hi na ho — na order
 * number, na confirmation number, aur na us phone par koi order.
 *
 * NOTE: is topic mein SAWAAL khali rehne chahiyein — sirf naam aur jawab.
 * Bina sawaal wale topics AI ko dikhaye bhi nahi jate, is liye ye sirf
 * wahin jata hai jahan code bhejta hai.
 */
export const TRACKING_UNKNOWN_TOPIC =
  process.env.TRACKING_UNKNOWN_TOPIC || 'Order Details Nahi Mili To Ye Ans Send Ho Ga'
