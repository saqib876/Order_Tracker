/**
 * Customer ke message par bot KYA karega — ye faisla yahan hota hai.
 *
 * route.ts sirf is faisle par amal karta hai (database, WhatsApp). Faisla
 * alag rakhne ka faida: ise bina database ke test kiya ja sakta hai, aur
 * har screenshot wala masla ek test ban jata hai.
 */

import {
  looksLikeOrderQuery,
  extractOrderNumber,
  extractConfirmationNumber,
  mentionsOrderNumber,
  extractPhone,
  isNumericOnlyMessage,
  extractTrackingCandidate,
  isAcknowledgementOnly,
  stripContacts,
  isContactOnly,
  saysNotOrderedYet,
  saysAlreadyOrdered,
} from '@/lib/messageParse'
import { detectManualReason } from '@/lib/intents'
import type { ManualReason } from '@/lib/intents'
import { looksLikeModelAvailability } from '@/lib/modelQuery'
import { looksLikeCustomization } from '@/lib/customQuery'

export interface MessagePlan {
  /** "No", "Ok", "Thanks", "No abhi nhi" — sawaal hi nahi, bot chup rahe */
  noQuestion: boolean
  /**
   * "Samsung A54 ka cover mil jayega?", "13 pro max?", "oppo a16 available ha"
   * — kisi bhi mobile/laptop model ki availability ka sawaal. Is par ek hi
   * message jata hai: "Yes Available" + order kaise place karna hai.
   *
   * Ye order-status se PEHLE aata hai, warna "mil jayega" ki wajah se bot
   * "apna order number bhejein" bhej deta tha.
   */
  modelAvailability: boolean
  /**
   * "Apni picture wala cover bana dein", "customize karwana hai" — is ka
   * jawab AAP ki Excel ki Customize wali row se jata hai.
   *
   * Ye model-availability aur order-status DONO se pehle aata hai, warna
   * aise sawaal "Yes Available" ya "apna order number bhejein" mein chale
   * jate the.
   */
  customization: boolean
  /** "Order kiya hi nahi" — abhi kharidar hai, order number maangna bekaar */
  notOrderedYet: boolean
  /** Message kisi maujooda order ke baare mein hai */
  orderish: boolean
  /**
   * Message mein se order/phone number uthana hai ya nahi. `orderish` ke
   * ilawa tab bhi, jab bot ne pichhle message mein number maanga tha aur
   * customer ab jawab de raha hai ("40981 hai").
   */
  readNumbers: boolean
  manualReason: ManualReason | null
  /**
   * Greeting ("how to place your order") sirf naye kharidar ke liye hai.
   * Jo customer apne maujooda order ki baat kar raha hai — order number,
   * "I have ordered", cancel, address change — use nahi jati.
   */
  skipGreeting: boolean
  /**
   * Order number maangna. Sirf EK dafa: agar pichhli baar maang chuke hain
   * to dobara nahi — warna har agla message ("Hi", "camera protection...")
   * par wahi message jata tha.
   */
  mayAskForNumber: boolean
  confirmationNumber: string | null
  orderNumber: string | null
  phoneInText: string | null
  trackingCandidate: string | null
}

export function planReply(text: string, opts: { alreadyAskedForNumber: boolean }): MessagePlan {
  // Email / link ke andar ke adad order number nahi hain
  const numbersText = stripContacts(text)

  // Sirf email bheja ho to bot chup — ye sawaal hi nahi hai
  const noQuestion = isAcknowledgementOnly(text) || isContactOnly(text)
  const notOrderedYet = !noQuestion && saysNotOrderedYet(text)

  const confirmationNumber = extractConfirmationNumber(numbersText)
  const orderNumber = extractOrderNumber(numbersText)
  const phoneInText = extractPhone(numbersText)
  const trackingCandidate = extractTrackingCandidate(numbersText)

  // Kya ye message waqai order ke baare mein hai?
  //
  // Pehle har message mein se koi bhi 3-6 digit ka number uthhaya jata tha,
  // chahe wo price ho ("1400 ka hai?") ya mobile model — us se kisi AUR ka
  // order is ajnabi ko chala jata tha. Isi liye ye guard hai.
  // Manual wajah (cancel, galat model mila...) sab par bhaari hai, phir
  // model availability — dono order-status se pehle aate hain.
  const manualReason = noQuestion ? null : detectManualReason(text)
  const customization = !noQuestion && !manualReason && looksLikeCustomization(text)
  const modelAvailability =
    !noQuestion && !manualReason && !customization && looksLikeModelAvailability(text)

  const orderish =
    !noQuestion &&
    !notOrderedYet &&
    !modelAvailability &&
    !customization &&
    (looksLikeOrderQuery(text) ||
      isNumericOnlyMessage(text) ||
      mentionsOrderNumber(text) ||
      saysAlreadyOrdered(text) ||
      // Apna mobile number bhejne ki aam tor par ek hi wajah hoti hai —
      // order dhoondwana.
      phoneInText !== null)

  const readNumbers =
    orderish ||
    (opts.alreadyAskedForNumber &&
      !noQuestion &&
      !notOrderedYet &&
      !modelAvailability &&
      !customization)

  // Availability wale jawab ke ANDAR hi greeting (how to place order) shamil
  // hoti hai, is liye alag se nahi bhejte — warna do message ban jate hain.
  const skipGreeting =
    orderish || modelAvailability || confirmationNumber !== null || manualReason !== null

  return {
    noQuestion,
    notOrderedYet,
    modelAvailability,
    customization,
    orderish,
    readNumbers,
    manualReason,
    skipGreeting,
    mayAskForNumber: orderish && !opts.alreadyAskedForNumber,
    confirmationNumber,
    orderNumber,
    phoneInText,
    trackingCandidate,
  }
}
