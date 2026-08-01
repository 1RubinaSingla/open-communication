/** Verifies the trivial-math pre-filter: cheap arithmetic must never reach Aristotle. */
import { trivialMath } from "../src/tools.js";

let pass = true;
const check = (n: string, ok: boolean) => { console.log(`   ${ok ? "✓" : "✗"} ${n}`); if (!ok) pass = false; };

console.log("1) trivial arithmetic is caught (answered locally)");
check('"What is 128 * 977?" -> 125056', trivialMath("What is 128 * 977?") === "125056");
check('"4823*197" -> 950131', trivialMath("4823*197") === "950131");
check('"compute (12+3)/5" -> 3', trivialMath("compute (12+3)/5") === "3");
check('"what is the value of 2+2" -> 4', trivialMath("what is the value of 2+2") === "4");
check('"100 - 45 =" -> 55', trivialMath("100 - 45 =") === "55");

console.log("2) real math still goes to Aristotle (null)");
check("proof request -> null", trivialMath("Prove that the square root of 2 is irrational.") === null);
check("symbolic -> null", trivialMath("Show that for all n, n^2 + n is even") === null);
check("word problem -> null", trivialMath("If a train leaves at 3pm going 60mph, when does it arrive 180 miles away?") === null);
check("integral -> null", trivialMath("Compute the integral of x^2 dx from 0 to 1") === null);
check("bare number -> null (not a question)", trivialMath("42") === null);
check("empty -> null", trivialMath("") === null);

console.log("3) no code execution / injection");
check("identifier rejected", trivialMath("process.exit(1)") === null);
check("function call rejected", trivialMath("what is require('fs')") === null);

console.log("\n" + (pass ? "OK — pre-filter verified." : "FAIL — see above."));
process.exit(pass ? 0 : 1);
