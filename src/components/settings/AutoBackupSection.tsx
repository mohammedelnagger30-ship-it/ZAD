import { useState, useEffect } from 'react';
import { Clock, Calendar, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Card, SectionHeader, Button } from '@/components/ui';
import {
  getAutoBackupConfig,
  saveAutoBackupConfig,
  performAutoBackup,
  getAutoBackups,
  restoreFromBackup,
  getLastBackupDate,
  type AutoBackupConfig,
} from '@/utils/autoBackup';

export function AutoBackupSection() {
  const [autoBackupConfig, setAutoBackupConfig] = useState<AutoBackupConfig>(getAutoBackupConfig());
  const [autoBackups, setAutoBackups] = useState<Array<{ date: string; key: string }>>([]);

  useEffect(() => {
    setAutoBackups(getAutoBackups());
  }, []);

  const handleAutoBackupConfigChange = (patch: Partial<AutoBackupConfig>) => {
    const newConfig = { ...autoBackupConfig, ...patch };
    setAutoBackupConfig(newConfig);
    saveAutoBackupConfig(newConfig);
  };

  const handleManualAutoBackup = async () => {
    const success = await performAutoBackup();
    if (success) {
      setAutoBackups(getAutoBackups());
      alert('تم إنشاء النسخة الاحتياطية التلقائية بنجاح');
    } else {
      alert('تعذّر إنشاء النسخة الاحتياطية');
    }
  };

  const handleRestoreAutoBackup = async (key: string) => {
    if (!confirm('هل أنت متأكد من استعادة هذه النسخة؟ سيتم استبدال جميع بياناتك الحالية.')) {
      return;
    }

    const success = await restoreFromBackup(key);
    if (success) {
      alert('تم استعادة النسخة الاحتياطية بنجاح');
      window.location.reload();
    } else {
      alert('تعذّر استعادة النسخة الاحتياطية');
    }
  };

  const handleDeleteAutoBackup = (key: string) => {
    if (!confirm('هل أنت متأكد من حذف هذه النسخة الاحتياطية؟')) {
      return;
    }
    localStorage.removeItem(key);
    setAutoBackups(getAutoBackups());
  };

  return (
    <Card>
      <SectionHeader title="النسخ الاحتياطي التلقائي" icon={<Clock size={20} />} />

      <div className="space-y-4">
        {/* Enable Toggle */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-800">
              <RefreshCw size={20} className="text-primary-600 dark:text-gold-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-200">
                تفعيل النسخ الاحتياطي التلقائي
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                يتم إنشاء نسخة احتياطية تلقائياً حسب التكرار المحدد
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleAutoBackupConfigChange({ enabled: !autoBackupConfig.enabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              autoBackupConfig.enabled ? 'bg-primary-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                autoBackupConfig.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {autoBackupConfig.enabled && (
          <div className="space-y-4 mr-6 border-r-2 border-primary-200 pr-4 dark:border-primary-800">
            {/* Frequency Selection */}
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                التكرار
              </label>
              <select
                value={autoBackupConfig.frequency}
                onChange={(e) => handleAutoBackupConfigChange({ frequency: e.target.value as AutoBackupConfig['frequency'] })}
                className="w-full rounded-lg border border-primary-200 bg-white px-3 py-2 text-sm text-primary-800 focus:border-primary-400 focus:outline-hidden dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-100"
              >
                <option value="daily">يومي</option>
                <option value="weekly">أسبوعي</option>
                <option value="monthly">شهري</option>
              </select>
            </div>

            {/* Max Backups Selection */}
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                عدد النسخ المحفوظة
              </label>
              <select
                value={autoBackupConfig.maxBackups}
                onChange={(e) => handleAutoBackupConfigChange({ maxBackups: Number(e.target.value) })}
                className="w-full rounded-lg border border-primary-200 bg-white px-3 py-2 text-sm text-primary-800 focus:border-primary-400 focus:outline-hidden dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-100"
              >
                <option value={3}>3 نسخ</option>
                <option value={5}>5 نسخ</option>
                <option value={10}>10 نسخ</option>
              </select>
            </div>

            {/* Last Backup Date */}
            {getLastBackupDate() && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                آخر نسخة: {new Date(getLastBackupDate()!).toLocaleDateString('ar-EG')}
              </p>
            )}

            {/* Manual Backup Button */}
            <Button
              size="sm"
              variant="secondary"
              onClick={handleManualAutoBackup}
              className="w-full md:w-auto"
            >
              إنشاء نسخة الآن
            </Button>
          </div>
        )}

        {/* Auto Backups List */}
        {autoBackups.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-primary-700 dark:text-primary-200 flex items-center gap-2">
              <Calendar size={16} />
              النسخ الاحتياطية المحفوظة
            </h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {autoBackups.map((backup) => (
                <div
                  key={backup.key}
                  className="flex items-center justify-between p-2 bg-primary-50 dark:bg-primary-800/30 rounded-lg"
                >
                  <span className="text-xs text-gray-600 dark:text-gray-300">
                    {new Date(backup.date).toLocaleDateString('ar-EG')}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleRestoreAutoBackup(backup.key)}
                      className="p-1.5 rounded-lg text-primary-600 hover:bg-primary-100 dark:text-primary-200 dark:hover:bg-primary-800"
                      title="استعادة"
                    >
                      <Upload size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAutoBackup(backup.key)}
                      className="p-1.5 rounded-lg text-error-600 hover:bg-error-50 dark:text-error-300 dark:hover:bg-error-900/20"
                      title="حذف"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
