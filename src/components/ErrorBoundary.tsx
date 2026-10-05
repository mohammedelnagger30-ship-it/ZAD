import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'حدث خطأ غير متوقع' };
  }

  componentDidCatch(error: Error) {
    console.error('App error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-surface-light dark:bg-surface-dark flex items-center justify-center p-6" dir="rtl">
          <div className="max-w-sm w-full text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-error-100 dark:bg-error-900/30 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-error-500">
                <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-primary-800 dark:text-primary-100 mb-2">حدث خطأ</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {this.state.message}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="px-6 py-2.5 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-smooth"
            >
              إعادة التشغيل
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
