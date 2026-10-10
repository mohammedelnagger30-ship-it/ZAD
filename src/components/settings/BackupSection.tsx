import { useState, useCallback } from 'react';
import { Download, Upload, Database } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { SectionTitle } from '@/components/settings/SectionTitle';
import { db } from '@/db/database';
import {
  ADHKAR_STATE_KEY,
  BACKUP_TABLES,
  IGNORED_BACKUP_KEYS,
  isValidAdhkarBackup,
  isValidBackupRow,
  type BackupTable,
} from '@/utils/backup';

/**
 * The Backup & Restore section, whole: its file handlers, its validation and
 * its status line used to live inside SettingsScreen, which made the screen's
 * body the only place any of it could run. As its own component the section
 * mounts, reads and writes the database entirely through `@/utils/backup` and
 * needs nothing from the screen around it.
 */
export function BackupSection() {
  const [exportStatus, setExportStatus] = useState('');

  const handleExport = useCallback(async () => {
    try {
      const data: Record<string, unknown> = {
        _exportDate: new Date().toISOString(),
      };
      data.settings = [await db.settings.get(1)];
      data.plans = await db.plans.toArray();
      data.tasks = await db.tasks.toArray();
      data.bookmarks = await db.bookmarks.toArray();
      data.pageBookmarks = await db.pageBookmarks.toArray();
      data.prayerRecords = await db.prayerRecords.toArray();
      data.sunnahRecords = await db.sunnahRecords.toArray();
      data.hifzProgress = await db.hifzProgress.toArray();
      data.hadithFavorites = await db.hadithFavorites.toArray();
      data.khatmah = await db.khatmah.toArray();
      const adhkarState = localStorage.getItem(ADHKAR_STATE_KEY);
      if (adhkarState) data.adhkar = JSON.parse(adhkarState) as unknown;

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hifzi-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus('تم التصدير بنجاح');
      setTimeout(() => setExportStatus(''), 3000);
    } catch {
      setExportStatus('فشل التصدير');
    }
  }, []);

  const handleImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (!data || typeof data !== 'object' || typeof data._exportDate !== 'string' || Number.isNaN(Date.parse(data._exportDate))) {
          setExportStatus('فشل الاستيراد - الملف ليس نسخة احتياطية صالحة');
          return;
        }
        for (const key of Object.keys(data)) {
          if (IGNORED_BACKUP_KEYS.includes(key)) continue;
          if (key === 'adhkar') {
            if (!isValidAdhkarBackup(data.adhkar)) {
              setExportStatus('فشل الاستيراد - بيانات الأذكار في النسخة غير صالحة');
              return;
            }
            continue;
          }
          if (!BACKUP_TABLES.includes(key as BackupTable)) {
            setExportStatus('فشل الاستيراد - بنية الملف غير صحيحة');
            return;
          }
          if (!Array.isArray(data[key]) || !(data[key] as unknown[]).every((row) => isValidBackupRow(key as BackupTable, row))) {
            setExportStatus('فشل الاستيراد - بنية الملف غير صحيحة');
            return;
          }
        }
        await db.transaction(
          'rw',
          BACKUP_TABLES.map((key) => db.table(key)),
          async () => {
            for (const key of BACKUP_TABLES) {
              if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
              const table = db.table(key);
              await table.clear();
              await table.bulkPut(data[key] as Record<string, unknown>[]);
            }
          }
        );
        if (data.adhkar !== undefined) {
          localStorage.setItem(ADHKAR_STATE_KEY, JSON.stringify(data.adhkar));
        }
        setExportStatus('تم الاستيراد بنجاح. جارٍ إعادة التشغيل...');
        setTimeout(() => window.location.reload(), 1500);
      } catch {
        setExportStatus('فشل الاستيراد - ملف غير صالح');
      }
    };
    reader.onerror = () => setExportStatus('فشل الاستيراد - تعذّرت قراءة الملف');
    reader.readAsText(file);
  }, []);

  return (
    <section className="space-y-2">
      <SectionTitle icon={<Database size={20} />} title="النسخ الاحتياطي واستعادة البيانات" />
      <Card className="space-y-3 border border-primary-200/80 shadow-md dark:border-primary-800/80">
        <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">
          يمكنك حفظ نسخة احتياطية من جميع بياناتك (خطط الحفظ، الورد اليومي، الفواصل، وإعدادات الصلاة) واستعادتها في أي وقت.
        </p>

        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="secondary" size="sm" onClick={handleExport} className="text-xs font-bold">
            <Download size={16} /> تصدير نسخة (JSON)
          </Button>
          <label className="block">
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
            <span className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-primary-200 bg-primary-100 px-4 py-2 text-xs font-bold text-primary-800 transition-all hover:bg-primary-200 dark:border-primary-700 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700">
              <Upload size={16} /> استيراد نسخة
            </span>
          </label>
        </div>
        {exportStatus && (
          <p className="text-xs font-bold text-center text-primary-700 dark:text-gold-300">
            {exportStatus}
          </p>
        )}
      </Card>
    </section>
  );
}
