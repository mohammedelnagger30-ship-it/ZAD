const fs = require('fs');
let content = fs.readFileSync('D:/Desktop/program/python/qran/src/screens/AdhkarScreen.tsx', 'utf8');
content = content.replace(
  /<span className="font-semibold">[\s\S]*?<\/span>/,
  '<span className="font-semibold">الفضل المذكور:</span>'
);
fs.writeFileSync('D:/Desktop/program/python/qran/src/screens/AdhkarScreen.tsx', content, 'utf8');
console.log('Fixed virtue label');