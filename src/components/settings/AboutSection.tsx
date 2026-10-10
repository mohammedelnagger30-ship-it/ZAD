import { Info } from 'lucide-react';
import { Card } from '@/components/ui';
import { SectionTitle } from '@/components/settings/SectionTitle';

export function AboutSection() {
  return (
    <>
      {/* About Application */}
      <section className="space-y-2">
        <SectionTitle icon={<Info size={20} />} title="عن التطبيق" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-2 text-xs text-gray-600 dark:text-gray-300">
          <p className="font-bold text-sm text-primary-900 dark:text-primary-50">قُرّة — رفيق القرآن والعبادة اليومية</p>
          <p>يعمل بالكامل بدون إنترنت بحفظ كامل لجميع بياناتك محلياً على جهازك.</p>
          <p className="pt-2 text-[11px] text-gray-400 dark:text-gray-500 border-t border-primary-100 dark:border-primary-800/50">
            الإصدار 1.0.6 • جميع الحقوق محفوظة
          </p>
        </Card>
      </section>
    </>
  );
}
