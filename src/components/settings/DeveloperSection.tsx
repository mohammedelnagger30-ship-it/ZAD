import { useState } from 'react';
import { Heart, MessageCircle, Send, UserRound } from 'lucide-react';
import { Card } from '@/components/ui';
import { SectionTitle } from '@/components/settings/SectionTitle';
import developerPhoto from '@/assets/developer-mohamed.jpeg';

const DEVELOPER_WHATSAPP = '201095236302';

export function DeveloperSection() {
  const [suggestion, setSuggestion] = useState('');
  const suggestionText = suggestion.trim();
  const whatsappUrl = `https://wa.me/${DEVELOPER_WHATSAPP}?text=${encodeURIComponent(
    `السلام عليكم م/ محمد، لدي اقتراح لتطوير تطبيق قُرّة:\n\n${suggestionText}`,
  )}`;

  return (
    <section className="space-y-2">
      <SectionTitle icon={<UserRound size={20} />} title="عن المطور والاقتراحات" />
      <Card className="space-y-4 border border-primary-200/80 shadow-md dark:border-primary-800/80">
        <div className="flex items-center gap-3">
          <img
            src={developerPhoto}
            alt="م/ محمد إبراهيم، مطور تطبيق قُرّة"
            className="h-16 w-16 shrink-0 rounded-full border-2 border-gold-300 object-cover object-[center_38%] shadow-md dark:border-gold-700"
            loading="lazy"
          />
          <div>
            <p className="text-sm font-extrabold text-primary-900 dark:text-primary-50">م/ محمد إبراهيم</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">مطور تطبيق قُرّة</p>
          </div>
        </div>

        <p className="text-xs leading-6 text-gray-600 dark:text-gray-300 md:text-sm">
          أعمل على تطوير قُرّة ليكون رفيقًا بسيطًا يعيننا على القرآن والعبادة، وأسعى دائمًا لتحسينه بما
          يناسب احتياجاتكم.
        </p>

        <div className="flex items-start gap-2 rounded-2xl bg-gold-50 p-3 text-gold-800 dark:bg-gold-950/30 dark:text-gold-200">
          <Heart size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-xs leading-5">
            لا تنسوني من صالح دعائكم، وأسأل الله أن يجعل هذا العمل نافعًا ومتقبلًا.
          </p>
        </div>

        <div className="space-y-2 border-t border-primary-100 pt-3 dark:border-primary-800/60">
          <label
            htmlFor="developer-suggestion"
            className="flex items-center gap-2 text-sm font-bold text-primary-900 dark:text-primary-100"
          >
            <MessageCircle size={17} aria-hidden="true" />
            اقتراح لتطوير التطبيق
          </label>
          <textarea
            id="developer-suggestion"
            value={suggestion}
            onChange={(event) => setSuggestion(event.target.value)}
            rows={3}
            placeholder="اكتب فكرتك أو ملاحظتك هنا..."
            className="w-full resize-y rounded-xl border border-primary-200 bg-[var(--field)] p-3 text-sm text-primary-900 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-primary-700 dark:text-primary-50 dark:placeholder:text-gray-500"
          />
          <a
            href={suggestionText ? whatsappUrl : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!suggestionText}
            className={`inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors md:w-auto ${
              suggestionText
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'
                : 'cursor-not-allowed bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
            }`}
          >
            <Send size={16} aria-hidden="true" />
            إرسال الاقتراح
          </a>
        </div>
      </Card>
    </section>
  );
}
