import React from 'react';
import { Customer } from '../types';
import { AlertCircle } from 'lucide-react';

interface CustomerAgreementAlertProps {
  customer?: Customer;
  moduleName: 'proformas' | 'purchase_orders' | 'packaging' | 'projects' | 'after_sales' | 'general';
}

export default function CustomerAgreementAlert({ customer, moduleName }: CustomerAgreementAlertProps) {
  if (!customer) return null;

  const relevantAgreements = (customer.moduleAgreements || []).filter(
    (agr) => agr.moduleName === moduleName || agr.moduleName === 'general'
  );

  if (relevantAgreements.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 animate-fade-in shadow-sm">
      <div className="flex gap-2">
        <AlertCircle className="text-amber-500 flex-shrink-0 mt-0.5" size={16} />
        <div className="text-right w-full">
          <h4 className="text-xs font-bold text-amber-800 mb-2">یادآور سیستم - توافقات با مشتری</h4>
          <ul className="space-y-1.5 list-disc list-inside">
            {relevantAgreements.map((agr) => (
              <li key={agr.id} className="text-[11px] text-amber-700 font-bold leading-relaxed">
                {agr.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
