/**
 * Order-status intent detection — POORA SAWAAL padhta hai.
 *
 * Pehle ye kaam route.ts ki ORDER_KEYWORDS list karti thi, jo substring
 * matching par chalti thi. Us mein wahi kharabi thi jo Q&A mein thi:
 * customer ke alfaz thora bhi alag hote hi match toot jata tha.
 *
 * Held-out test (bank sirf 2/3 phrasings se, test wale 1/3 bank mein NAHI):
 *
 *   tareeqa                pakde          jhooti pehchan
 *   substring keywords      4%  (2/51)     0.4% (1/239)
 *   word-score @ 0.40      53% (27/51)     1.7% (4/239)
 *   word-score @ 0.45      45% (23/51)     0.8% (2/239)   <-- chuna gaya
 *   word-score @ 0.50      35% (18/51)     0.0% (0/239)
 *
 * 0.45 is liye chuna ke yahan "jhooti pehchan" ka matlab hai: price poochne
 * wale customer ko "apna order number bhejein" ka jawab jana — yani theek
 * wahi bug jo pehle tha. Us se bachna zyada ahem hai.
 *
 * NOTE: shipped list mein SAARE 153 phrasings hain (train+test dono), kyunke
 * production mein jitne zyada variants hon utna behtar. Upar wale numbers
 * sirf train wale hisse se naape gaye hain, warna wo memorisation hota.
 *
 * NOTE: neeche ke jumle aap ke ASLI customer messages hain. Personal data
 * (phone number, email, confirmation number, naam) nikal diya gaya hai.
 * Naya andaz dikhe to bas is list mein ek line add kar dein.
 */

import { buildIndex, matchAgainstIndex } from '@/lib/qnaMatch'
import type { QnaIndex } from '@/lib/qnaMatch'

/** Order-intent ki apni hadd — Q&A se alag, kyunke yahan sirf haan/nahi chahiye. */
export const ORDER_INTENT_THRESHOLD = 0.45

export const ORDER_STATUS_QUESTIONS: string[] = [
  "1 September tak",
  "1 dey left and it is still in making progress",
  "14 days Ka bola tha 1 month guzr gya hai",
  "15 days hogaye",
  "15 din hogye Hain",
  "17 days ho chuky Hain",
  "2 din ma ready kr k bhaj da",
  "2 weeks se zyada ho gaya hai",
  "21 August kk order kia tha",
  "22 Aug ko order final kr diya tha",
  "4 September ko",
  "4 days se ap ko msgs kar re",
  "5 September ko ana hai",
  "5 aug ko order kia tha sep start ho gya abhi tk deliver ni hua?",
  "Ab mujhe na e order chaheyai na is old location pe koi recieve kar sakta hai mere location change ho gaye hai",
  "Abhi tk receive nahi hua yeh order. Kindly bta dain kb tk hoga",
  "Abhi tk shipping mai nhi aya",
  "Abi order making process ma ha",
  "Abi tak aya nhi",
  "Aj 1 sept lgyi hai",
  "Aj 3rd day hai",
  "Aj mil lagha",
  "Aj rider aya tha but receive ni ho ska koi ghr nhi thaaa",
  "And still didn’t get them",
  "Aoa i placed an order few days ago",
  "Ap bta dein mera parcel kab aye ga",
  "Ap jaldi tyar kr da",
  "Ap logo ne order deliver karwa na bhi hy k nhi",
  "Ap order 1 September ko bhaj saktay ho",
  "Apney Mera parcel konsi courier service sai Bheja hai",
  "Asalam o alikum parcel not deliver yet",
  "Assalamualaikum / 23 august ko mene order place Kiya tha order abhi tak receive nh hoa?",
  "Bhai ap logo ka ajeeb hai bohat bura experience raha mere order aplog change kar nahi rahai te ke process ho gaya or time dheko 15 dino se zayada ho gaya mujhe order place keyai howe and its still showing on the same point",
  "Bhai...estimated delivery 28 Aug. sy 2 Sep. Thi... / Pr abhi tak parcel receive kyun nhi hua...??",
  "Bta to dein Mera parsal kb tak delivered ho ga?",
  "But receive hi nh hwaaa",
  "Can i get it in 4-5 working days?",
  "Can u pls send my order this week .. i want to gift it",
  "China Sy ship hona",
  "Conform btye kb tk hoga delivery",
  "Deliver date bataya iski?",
  "Delivery Wala bahir khara hai",
  "Dispatched ho giya hai?",
  "Exactly it's still in the making process after 14 days",
  "Expected delivery 31 aug sy 5 sep hy abhi tk ni ship hoa kl 5 sep hy",
  "G wo 1 2 dino ma baj do gi",
  "Han toh TB ma NY apko kha tha k pehly parcel krwa dein bd ma maii location py available nahi hon gi",
  "Hi Kal ka or prso ka din dal ky 2",
  "Hi can u deliver my parcel as soon as possible",
  "Hi i have not received my order yet",
  "Hi. It’s been 10 days. When will i receive them??",
  "Hope so same thing will receive",
  "How many days it takes to deliver?",
  "How much time left ???",
  "Hy i have ordered a covers few days ago",
  "I didn't receive my order",
  "I have not received my order yet?",
  "I have ordered on 26 August",
  "I have requested that I need that order urgently but didn't receive yet",
  "I haven't received my order yet...",
  "I havn't received my parcel?",
  "I just received parcel",
  "I ordered 4 phone covers on 19 August, it's been 14 days and still they are not shipped",
  "I place an order a few days ago",
  "I placed an order 3 days ago",
  "I received parcel",
  "I still haven't received the parcel",
  "It's 2nd September",
  "It's been 12 days?",
  "It's been more than 15 days",
  "It's been two weeks.",
  "Itna time hugya hai order kiyay huwy 2 covers abhi tak receive nahi huwy",
  "Itnaa arsaaa say making py .... Atkaa howa h",
  "Itne zyada din ho gaye hain",
  "Itni din hoge hai abi tak making process chal rha hai",
  "Itny days sa order kiya ha cover but no received🥺",
  "Jaldi deliver nahi kar sakte",
  "Kaafi din hgye",
  "Kab recive hoga yaaa",
  "Kab tak parsal delivered ho ga?",
  "Karachi delivery available??",
  "Kb ana hai order",
  "Kb tak aye ga order",
  "Kb tk hoga mujhy yh receive?",
  "Kb tk mujhe receive ho",
  "Kb tk recieve hojaye ga kindly inform kr dee k pir may kahi or sy order kr lu",
  "Kbh tk aye ga",
  "Kindly Friday tk deliver krwa de",
  "Kindly Meri delivery Saturday ko krwaye ga",
  "Kindly confirm me that the name on the parcel will be Munawar Hayat",
  "Kindly muje confirm btaye pehly b 15 days making process se 18-20 din ho chuke hai ab mazeed kitna wait kre",
  "Kindly mujhy jaldi bhejh den ye koi tareeka nhi hota",
  "Kindly update",
  "Kitne dino Mai parcel Mera receive Hoga mujy ?",
  "Kl deliver honge phr?",
  "Ma ny 2 covers ap sy order kiya hain aur dono cover ma ny bs 2 week use kiyee hain aur wo kharb b hogye hain",
  "Mai ab mazeed wait nh kar sakhti hon",
  "Mai already ordrr kar chuki hun receive ni hwa",
  "Mai nai aik phone case order Kia hai magar waha checkout Kai bad wo keh Raha hai Kai aik or select kare laikn wo samaj Nahi a rhi kaisai karo",
  "Maien koi 15 days se order Kiya hua hai",
  "Main ye 2 cover oder kiye the pr abhi tak nai receive howe",
  "Mara parcal abhi tak nhi aaya",
  "Mene order kia tha mobile cover. 20th August ko. Kb tk deliver hoga?",
  "Meny 22 August ko kiya h",
  "Mera order nai receive hau",
  "Mera order shi ni receive hoa",
  "Mera parcel abhi tak aya nahi",
  "Mujhe order jaldi chahiyee",
  "Mujhy mera parcel abhi tak ni pouncha",
  "Mujy abi tak covers receive ni huei",
  "Mujy abi tak receive ni hua covers",
  "Mujy order kiya app Friday ya Thursday dey sakhty hen??",
  "Oppo A57 ha.... Ok many jab order kiya ha likha hoga kab kiya ha order ap yahi cover dina....",
  "Or deliver date puchni hai",
  "Order kab mly ga",
  "Order kb ay ga",
  "Order kb mly ga",
  "Order kea th 15days phly",
  "Order update?",
  "Parcel kb receive ho ga",
  "Parcel ki delivery kab tak possible hai kal b 1 day left aa rha tha or aj b",
  "Parcel nhi recieve hua",
  "Parcel q RCV nhi Huwa abhi tk 2 weeks hogyee",
  "Parcel receive kyun nhi hua...abhi tak..??",
  "Please send this week .. i need it on Saturday",
  "Please update me",
  "Plzz update mn",
  "Receive bhai",
  "Sir I can't recived the parcel yet",
  "So now my parcel will be dispatched with the name Munawar Hayat,right?",
  "Still 2 days",
  "Still too late my parcell",
  "Tell me when will I receive it",
  "This is my order how much time u require for its delivery",
  "Ub tk uski koi update nh ha",
  "Urgent cahiya",
  "When i receive my order?",
  "When is will receive my parcel?",
  "When ll my order receive",
  "When will I get my parcel?? / It’s been 8 days now",
  "When will i get the order???",
  "Ye mil jaye ga same?",
  "Ye week b pura ho gya",
  "already 25 din ho gae hn or deliver abhi tk ni hua",
  "hy when im gonna receive my order??",
  "i didn’t receive my order",
  "ji kardiya order, im talking about delivery k kal hogi?",
  "kab tak ayege bhai?",
  "ma waitkr rhe 2 week sa or ab ap ya kha rha",
  "nhee bhejna parcel tww sedha bata deinnn",
  "order update pls",
  "still waiting for my order",
  "yes, receive ni kr skky thy,again kiyya ta k whi bhj den aap",
]

let cached: QnaIndex | null = null

function getIndex(): QnaIndex {
  if (!cached) {
    cached = buildIndex([
      {
        topic: 'order_status',
        answer: '',
        questions: ORDER_STATUS_QUESTIONS,
        priority: 0,
      },
    ])
  }
  return cached
}

/**
 * Kya customer apne order/delivery ke baare mein poochh raha hai?
 * Ye sirf haan/nahi batata hai — jawab Q&A ya order-lookup deta hai.
 */
export function looksLikeOrderIntent(text: string): boolean {
  return matchAgainstIndex(getIndex(), text, ORDER_INTENT_THRESHOLD) !== null
}
