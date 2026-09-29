import { useState } from 'react';
import ConnectionScreen from './components/ConnectionScreen';
import QueryInterface from './components/QueryInterface';
import { disconnectSession } from './api';

export default function App() {
  const [session, setSession] = useState(null);

  const disconnect = async () => {
    if (session) {
      try {
        await disconnectSession(session.session_id);
      } catch {}
    }
    setSession(null);
  };

  return session ? (
    <QueryInterface
      session={session}
      onDisconnect={disconnect}
      onSessionRefresh={setSession}
    />
  ) : (
    <ConnectionScreen onConnected={setSession} />
  );
}
