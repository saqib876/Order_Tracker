/**
 * Bot ke wo jawab jo Excel mein nahi hain — code ke andar likhe hue.
 *
 * Ye yahan is liye rakhe hain ke do jagah inhein dekhna parta hai:
 *   1. webhook — bhejne ke liye
 *   2. Sehat ka safha — ye batane ke liye ke "aaj ye jawab kitni dafa gaya"
 *
 * Matan badlein to dono jagah khud ba khud badal jayega.
 */

/** Model maujood hai — is ke sath aksar greeting bhi jati hai */
export const AVAILABLE_LINE = '*Yes Available*'

/** Order ki pehchan maangne wala message */
export const ORDER_INFO_MAANGO = [
  'Please Apna ( Text Msg Ma Type Kr K Send Kr Dain )',
  '',
  'Order Number (Jaise 40981), ',
  'Confirmation Number (Jaise #N8FNNZAKE) ',
  'Ya Jis Mobile Number Se Order Kiya Tha Wo Bhej Dein — Main Abhi Check Karti Hun.',
].join('\n')

/** Number to mila lekin us ka koi order nahi — dobara sahi number maango */
export const ORDER_NAHI_MILA = [
  'Is Number Se Koi Order Nahi Mil Raha. Please Apna Correct ',
  '',
  'Order Number (Jaise 40981), ',
  'Confirmation Number (Jaise #N8FNNZAKE) ',
  'Ya Jis Mobile Number Se Order Kiya Tha Wo Bhej Dein — Main Again Check Karti Hun.',
].join('\n')

/**
 * Sawaal order tracking ka hai, lekin bot ko order mila hi nahi — na order
 * number, na confirmation number, aur na us phone par koi order.
 *
 * Aise mein customer ko khali haath nahi chhorte: website ka tracking link
 * bhej dete hain taake wo khud dekh le.
 */
export const TRACK_LINK_JAWAB = [
  'Dear Customer,',
  '',
  'You can track your shipment using the link below:',
  '',
  '🔗 https://myzan.net/pages/track-your-order',
  '',
  'Thank you for choosing us!',
  '',
  'Best regards,',
  'Myzan',
].join('\n')
