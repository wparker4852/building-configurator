// Lead capture + quote generation.

import { useState } from 'react';
import type { Audience } from '../core/types';
import type { Lead } from './quoteDoc';

export default function QuoteDialog({
  audience,
  total,
  onClose,
  onSubmit,
}: {
  audience: Audience;
  total: string;
  onClose: () => void;
  onSubmit: (lead: Lead) => void;
}) {
  const internal = audience === 'internal';
  const [lead, setLead] = useState<Lead>({ name: '', email: '', phone: '', zip: '', notes: '' });
  const [touched, setTouched] = useState(false);

  const set = (patch: Partial<Lead>) => setLead((l) => ({ ...l, ...patch }));
  // Customers must leave a way to reach them; internal sheets can be anonymous.
  const valid = internal || (lead.name.trim().length > 1 && (lead.email.includes('@') || lead.phone.trim().length >= 7));

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    onSubmit(lead);
  };

  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true">
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="body">
          <div>
            <h2>{internal ? 'Build quote sheet' : 'Request your quote'}</h2>
            <p className="field-note" style={{ marginTop: 4 }}>
              {internal
                ? 'Generates a printable sheet with cost and margin included.'
                : `We'll send a written quote for your ${total} design and follow up within one business day.`}
            </p>
          </div>

          <div className="grid2">
            <div className="field">
              <span className="field-label">Name{internal ? '' : ' *'}</span>
              <input value={lead.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
            </div>
            <div className="field">
              <span className="field-label">Delivery ZIP</span>
              <input value={lead.zip} onChange={(e) => set({ zip: e.target.value })} inputMode="numeric" />
            </div>
            <div className="field">
              <span className="field-label">Email</span>
              <input type="email" value={lead.email} onChange={(e) => set({ email: e.target.value })} />
            </div>
            <div className="field">
              <span className="field-label">Phone</span>
              <input type="tel" value={lead.phone} onChange={(e) => set({ phone: e.target.value })} />
            </div>
          </div>

          <div className="field">
            <span className="field-label">Anything we should know?</span>
            <textarea rows={3} value={lead.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>

          {touched && !valid && (
            <div className="issue error" style={{ fontSize: 12 }}>
              <span>&#9650;</span>
              <span>Add your name and either an email or a phone number.</span>
            </div>
          )}
        </div>

        <div className="foot">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            {internal ? 'Generate sheet' : 'Send my request'}
          </button>
        </div>
      </div>
    </div>
  );
}
