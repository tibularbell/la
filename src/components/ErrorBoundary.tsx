import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    let displayMsg = error.message || 'เกิดข้อผิดพลาดในการแสดงผล';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; path?: string };
      if (parsed?.error) {
        displayMsg = parsed.error.includes('Missing or insufficient permissions')
          ? `คุณไม่มีสิทธิ์เข้าถึงข้อมูลในส่วนนี้ (${parsed.path ?? 'ระบบฐานข้อมูล'})`
          : parsed.error;
      }
    } catch {
      // Keep original message
    }
    return { hasError: true, message: displayMsg };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('App ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">ระบบพบข้อผิดพลาดชั่วคราว</h2>
            <p className="text-sm text-slate-600 leading-relaxed">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] px-4 py-2.5 bg-teal-700 text-white text-sm font-medium rounded-xl hover:bg-teal-800 transition-colors"
            >
              โหลดหน้าจอใหม่อีกครั้ง
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
