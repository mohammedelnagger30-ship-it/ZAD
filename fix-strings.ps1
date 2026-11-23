$content = Get-Content 'D:\Desktop\program\python\qran\src\screens\AdhkarScreen.tsx' -Raw -Encoding UTF8
$content = $content -replace "\{isComplete \? '.+?' : '.+?'\}", "{isComplete ? 'أتممت هذه الفئة، تقبل الله.' : 'اضغط على زر العد بعد قراءة الذكر.'}"
$content = $content -replace "<RotateCcw size=\{13\} />\s*[^\n]*", "<RotateCcw size={13} />`n          تصفير الفئة"
Set-Content 'D:\Desktop\program\python\qran\src\screens\AdhkarScreen.tsx' -Encoding UTF8 -Value $content