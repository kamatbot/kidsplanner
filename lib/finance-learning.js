"use strict";
// Short original lessons informed by Investor.gov's saving and investing basics.
const rows = [
  ["needs", "Needs before wants", "A need helps you live and learn, like lunch. A want is something enjoyable, like a new game. Planning for needs first helps your money last.", "Which should come first in your budget?", ["Lunch for school", "A new game", "Another toy"], 0, "Cover needs first, then decide which wants matter most."],
  ["goal", "Give your savings a job", "A clear goal has a name, a cost and a date. Saving 50 fams each week toward a 300-fam goal takes six weeks, if you do not spend those savings.", "At 50 fams a week, how long to save 300?", ["3 weeks", "6 weeks", "30 weeks"], 1, "300 divided by 50 is six weeks."],
  ["budget", "Make a spending plan", "A budget is a plan for money coming in and going out. You can choose how much to save, spend and share before you spend anything.", "You have 100 fams and save 30. What remains?", ["130 fams", "30 fams", "70 fams"], 2, "100 minus 30 leaves 70 fams to plan for."],
  ["tradeoff", "Every choice has a trade-off", "Money spent today cannot also go toward another goal. The next-best choice you give up is called an opportunity cost.", "You buy a toy with your bike savings. What is the trade-off?", ["The bike goal may take longer", "The bike becomes free", "Your savings increase"], 0, "Choosing the toy leaves less saved for the bike."],
  ["buffer", "Keep a little cushion", "An emergency cushion is money set aside for unexpected needs. Keeping it easy to reach can help when plans change.", "Where should money for an unexpected need be?", ["Somewhere you cannot access for years", "Easy to access when needed", "Already spent"], 1, "Emergency savings should be available when you need them."],
  ["interest", "Money can earn interest", "Interest is money paid for using money. A savings account may pay you interest. Borrowing money may mean you pay interest to someone else.", "What can happen when you borrow money?", ["You never repay it", "It always doubles", "You may repay extra interest"], 2, "Borrowing can cost more than the amount borrowed."],
  ["compound", "Growth can grow too", "Compounding means earning returns on your starting money and on earlier returns. At a hypothetical 10% a year, 100 becomes 110, then 121 if that return happens again.", "Why does the second year add 11, not 10?", ["The earlier 10 also earns a return", "Money must grow every year", "The first 100 disappears"], 0, "The second year's return is on 110. Real investment returns are not guaranteed."],
  ["time", "Small steps have time to grow", "Regular saving builds a habit. More time can allow more compounding, but the result depends on returns, fees and whether you keep saving.", "Which is a saving habit you can control?", ["Tomorrow's market return", "Setting aside money regularly", "The price of every investment"], 1, "You can choose a regular saving habit; market returns are uncertain."],
  ["risk", "Investing includes risk", "Investing means buying something with the hope it will provide income or become more valuable. Its value can fall, and you can lose money.", "Which statement about investing is true?", ["Profit is certain", "Prices only rise", "You can lose money"], 2, "Investing carries risk, even when an example chart looks smooth."],
  ["diversify", "Spread your eggs", "Diversification means spreading investments across different things. It can reduce the harm of one investment doing badly, but cannot remove all risk.", "What can diversification do?", ["Reduce dependence on one investment", "Guarantee profit", "Remove every risk"], 0, "Spreading investments reduces concentration; losses are still possible."],
  ["horizon", "Match money to the deadline", "Money needed soon has less time to recover from a drop in value. A longer goal may allow more time, but the right risk depends on your situation.", "You need money for next week's trip. What matters most?", ["Taking the biggest risk", "Keeping it available and stable", "Locking it away for years"], 1, "Near-term needs call for accessible, stable money."],
  ["inflation", "Prices change", "Inflation means prices rise overall. If your money stays the same while prices rise, it buys less. A higher balance does not always mean more buying power.", "A snack rises from 20 to 25 THB. The same 100 THB buys…", ["More snacks", "The same number", "Fewer snacks"], 2, "Your money buys less when the price rises."],
  ["fees", "Small fees add up", "Fees are charges for a service. They reduce the money left for you and can reduce future growth. Compare costs and ask an adult to help explain unclear charges.", "What do investment fees do?", ["Reduce the return you keep", "Guarantee a bigger return", "Create free money"], 0, "Fees lower the amount you keep and can compound over time."],
  ["scams", "Pause before a promise", "A promise of huge guaranteed returns with no risk is a warning sign. Pause, check reliable information and talk with a trusted adult before sharing money or account details.", "Someone promises to double your money overnight. What next?", ["Send your password", "Pause and ask a trusted adult", "Pay before the offer expires"], 1, "Pressure and guaranteed huge returns are warning signs. Slow down and check."],
];
const lessons = rows.map(([id,title,body,question,options,answer,explanation]) => ({id,title,body,question,options:options.map((text,i)=>({id:String(i),text})),answerId:String(answer),explanation}));
function projection(input) {
  if (!input || Object.keys(input).some(k=> !["principal","monthlyContribution","annualRate","years"].includes(k))) return {error:"Invalid projection."};
  const {principal,monthlyContribution,annualRate,years}=input;
  if (![principal,monthlyContribution,annualRate,years].every(Number.isFinite) || principal<0 || principal>1e7 || monthlyContribution<0 || monthlyContribution>1e6 || annualRate< -50 || annualRate>30 || !Number.isInteger(years) || years<1 || years>50) return {error:"Use amounts from 0, a rate between -50% and 30%, and 1–50 whole years."};
  let total=principal;
  const rate=annualRate/1200, round=n=>Math.round(n*100)/100;
  const series=[{year:0,total:round(total),contributions:round(principal)}];
  for(let month=1;month<=years*12;month++) {
    total=total*(1+rate)+monthlyContribution;
    if(month%12===0) series.push({year:month/12,total:round(total),contributions:round(principal+monthlyContribution*month)});
  }
  const contributions=principal+monthlyContribution*years*12;
  return {total:round(total),contributions:round(contributions),growth:round(total-contributions),series};
}
module.exports={lessons,projection};
