const fs = require('fs');

const content = fs.readFileSync('D:/Desktop/program/python/qran/src/screens/AdhkarScreen.tsx', 'utf8');

// Fix the isComplete ternary string
const fixed1 = content.replace(
  /\{isComplete \? '.+?' : '.+?'\}/,
  "{isComplete ? '\u0623\u062A\u0645\u0645\u062A \u0647\u0630\u0647 \u0627\u0644\u0641\u0626\u0629\u060C \u062A\u0642\u0628\u0644 \u0627\u0644\u0644\u0647.' : '\u0627\u0636\u063A\u0637 \u0639\u0644\u0649 \u0632\u0631 \u0627\u0644\u0639\u062F \u0628\u0639\u062F \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0630\u0643\u0631.'}"
);

// Fix the RotateCcw button text
const fixed2 = fixed1.replace(
  /<RotateCcw size=\{13\} \/>[\s\S]*?(?=<\/button>)/,
  "<RotateCcw size={13} />\n          \u062A\u0635\u0641\u064A\u0631 \u0627\u0644\u0641\u0626\u0629"
);

fs.writeFileSync('D:/Desktop/program/python/qran/src/screens/AdhkarScreen.tsx', fixed2, 'utf8');
console.log('Fixed');