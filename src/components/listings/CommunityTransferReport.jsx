import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Upload, CheckCircle, Users } from 'lucide-react';

const PLATFORMS = [
  { value: 'ticketmaster', label: 'Ticketmaster' },
  { value: 'seatgeek', label: 'SeatGeek' },
  { value: 'axs', label: 'AXS' },
  { value: 'stubhub', label: 'StubHub' },
  { value: 'apple_wallet', label: 'Apple Wallet' },
  { value: 'other', label: 'Other' },
];

/**
 * Lets any user report whether transfers are available for an event.
 * Props:
 *   event: Event entity
 *   userEmail: string
 *   recentReports: TransferReport[] — recent reports for this event
 *   onSubmitted: () => void
 */
export default function CommunityTransferReport({ event, userEmail, recentReports = [], onSubmitted }) {
  const [open, setOpen] = useState(false);
  const [reportType, setReportType] = useState(null);
  const [platform, setPlatform] = useState('');
  const [proofFile, setProofFile] = useState(null);
  const [proofUrl, setProofUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const openCount = recentReports.filter(r => r.report_type === 'transfer_available').length;
  const closedCount = recentReports.filter(r => r.report_type === 'transfer_unavailable').length;
  const hasReports = recentReports.length > 0;

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setProofUrl(file_url);
    setUploading(false);
  };

  const handleSubmit = async () => {
    if (!reportType) return;
    setSaving(true);
    await base44.entities.TransferReport.create({
      event_id: event.id,
      reporter_email: userEmail,
      report_type: reportType,
      platform: platform || undefined,
      screenshot_url: proofUrl || undefined,
    });
    setSaving(false);
    setSubmitted(true);
    setTimeout(() => {
      setOpen(false);
      setSubmitted(false);
      setReportType(null);
      setPlatform('');
      setProofUrl('');
      onSubmitted?.();
    }, 1500);
  };

  return (
    <div>
      {/* Summary row */}
      {hasReports && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap mb-2">
          <Users className="w-3.5 h-3.5 flex-shrink-0" />
          {openCount > closedCount ? (
            <span style={{ color: '#00FF87' }}>Community reports transfers still available ({openCount})</span>
          ) : closedCount > openCount ? (
            <span style={{ color: '#FF2D78' }}>Community reports transfers appear closed ({closedCount})</span>
          ) : (
            <span>Mixed community reports ({openCount} open · {closedCount} closed)</span>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
        style={{ background: 'rgba(255,255,255,0.05)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        📢 Report Transfer Status
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-2xl"
            style={{ background: 'hsl(255 12% 9%)', border: '1px solid rgba(255,255,255,0.12)' }}>

            <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="font-bold text-sm text-foreground">Report Transfer Status</div>
              <p className="text-xs text-muted-foreground mt-0.5">{event.title}</p>
            </div>

            <div className="p-5 space-y-4">
              {submitted ? (
                <div className="text-center py-6">
                  <CheckCircle className="w-10 h-10 mx-auto mb-2" style={{ color: '#00FF87' }} />
                  <p className="font-bold text-sm text-foreground">Thanks for reporting!</p>
                  <p className="text-xs text-muted-foreground mt-1">This helps other fans make informed decisions.</p>
                </div>
              ) : (
                <>
                  <p className="text-sm font-semibold text-foreground">
                    Can you currently see the Transfer button in your ticketing app?
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setReportType('transfer_available')}
                      className="flex flex-col items-center gap-1.5 py-4 rounded-xl text-sm font-bold transition-all"
                      style={{
                        background: reportType === 'transfer_available' ? 'rgba(0,255,135,0.12)' : 'rgba(255,255,255,0.04)',
                        border: reportType === 'transfer_available' ? '1.5px solid rgba(0,255,135,0.4)' : '1px solid rgba(255,255,255,0.1)',
                        color: reportType === 'transfer_available' ? '#00FF87' : 'hsl(var(--muted-foreground))',
                      }}
                    >
                      ✅ YES
                    </button>
                    <button
                      onClick={() => setReportType('transfer_unavailable')}
                      className="flex flex-col items-center gap-1.5 py-4 rounded-xl text-sm font-bold transition-all"
                      style={{
                        background: reportType === 'transfer_unavailable' ? 'rgba(255,45,120,0.1)' : 'rgba(255,255,255,0.04)',
                        border: reportType === 'transfer_unavailable' ? '1.5px solid rgba(255,45,120,0.4)' : '1px solid rgba(255,255,255,0.1)',
                        color: reportType === 'transfer_unavailable' ? '#FF2D78' : 'hsl(var(--muted-foreground))',
                      }}
                    >
                      ❌ NO
                    </button>
                  </div>

                  {/* Platform */}
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1.5">Platform (optional)</label>
                    <div className="flex gap-2 flex-wrap">
                      {PLATFORMS.map(p => (
                        <button key={p.value} type="button"
                          onClick={() => setPlatform(v => v === p.value ? '' : p.value)}
                          className="px-2.5 py-1 rounded-lg text-xs transition-all"
                          style={{
                            background: platform === p.value ? 'rgba(191,95,255,0.12)' : 'rgba(255,255,255,0.04)',
                            border: platform === p.value ? '1px solid rgba(191,95,255,0.4)' : '1px solid rgba(255,255,255,0.08)',
                            color: platform === p.value ? '#BF5FFF' : 'hsl(var(--muted-foreground))',
                          }}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Screenshot */}
                  {proofUrl ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
                      style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.25)', color: '#00FF87' }}>
                      <CheckCircle className="w-3.5 h-3.5" /> Screenshot attached ✓
                      <button onClick={() => setProofUrl('')} className="ml-auto text-muted-foreground hover:text-foreground">Remove</button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 px-4 py-3 rounded-xl cursor-pointer text-xs text-muted-foreground"
                      style={{ border: '1.5px dashed rgba(255,255,255,0.15)' }}>
                      {uploading
                        ? <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        : <Upload className="w-3.5 h-3.5" />}
                      {uploading ? 'Uploading…' : 'Optional screenshot'}
                      <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
                    </label>
                  )}

                  <button
                    onClick={handleSubmit}
                    disabled={!reportType || saving}
                    className="w-full py-3 rounded-full font-black text-sm flex items-center justify-center gap-2 disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg, #BF5FFF, #00C8FF)', color: '#fff' }}
                  >
                    {saving
                      ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : 'Submit Report'
                    }
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}