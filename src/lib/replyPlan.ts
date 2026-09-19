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
  saysNotOrderedYet,
  saysAlreadyOrdered,
} from '@/lib/messageParse'
import { detectManualReason } from '@/lib/intents'
import type { ManualReason } from '@/lib/intents'

export interface MessagePlan {
  /** "No", "Ok", "Thanks", "No abhi nhi" — sawaal hi nahi, bot chup rahe */
  noQuestion: boolean
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
  const noQuestion = isAcknowledgementOnly(text)
  const notOrderedYet = !noQuestion && saysNotOrderedYet(text)

  const confirmationNumber = extractConfirmationNumber(text)
  const orderNumber = extractOrderNumber(text)
  const phoneInText = extractPhone(text)
  const trackingCandidate = extractTrackingCandidate(text)

  // Kya ye message waqai order ke baare mein hai?
  //
  // Pehle har message mein se koi bhi 3-6 digit ka number uthhaya jata tha,
  // chahe wo price ho ("1400 ka hai?") ya mobile model — us se kisi AUR ka
  // order is ajnabi ko chala jata tha. Isi liye ye guard hai.
  const orderish =
    !noQuestion &&
    !notOrderedYet &&
    (looksLikeOrderQuery(text) ||
      isNumericOnlyMessage(text) ||
      mentionsOrderNumber(text) ||
      saysAlreadyOrdered(text) ||
      // Apna mobile number bhejne ki aam tor par ek hi wajah hoti hai —
      // order dhoondwana.
      phoneInText !== null)

  const readNumbers = orderish || (opts.alreadyAskedForNumber && !noQuestion && !notOrderedYet)

  const manualReason = noQuestion ? null : detectManualReason(text)

  const skipGreeting = orderish || confirmationNumber !== null || manualReason !== null

  return {
    noQuestion,
    notOrderedYet,
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
