
import React from 'react';
import { TranscriptionStatus } from '../types';

interface StatusIndicatorProps {
  status: TranscriptionStatus;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status }) => {
  const getStatusInfo = () => {
    switch (status) {
      case TranscriptionStatus.LISTENING:
        return { color: 'bg-green-500 animate-pulse', text: 'Listening...' };
      case TranscriptionStatus.CONNECTING:
        return { color: 'bg-yellow-500 animate-pulse', text: 'Connecting...' };
      case TranscriptionStatus.STOPPED:
        return { color: 'bg-gray-500', text: 'Stopped' };
      case TranscriptionStatus.ERROR:
        return { color: 'bg-red-500', text: 'Error' };
      case TranscriptionStatus.IDLE:
      default:
        return { color: 'bg-gray-500', text: 'Idle' };
    }
  };

  const { color, text } = getStatusInfo();

  return (
    <div className="flex items-center space-x-3 bg-gray-800 px-4 py-2 rounded-full">
      <div className={`w-3 h-3 rounded-full ${color}`}></div>
      <span className="text-sm font-medium text-gray-300">{text}</span>
    </div>
  );
};

export default StatusIndicator;
