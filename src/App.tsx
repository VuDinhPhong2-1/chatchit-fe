import { useEffect, useRef, useState } from 'react';
import { socket } from './socket';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL;

type Room = {
  _id: string;
  name: string;
  type: 'private' | 'group';
  enableAi: boolean;
};

type RoomMessage = {
  _id?: string;
  roomId?: string;
  senderType: 'human' | 'ai';
  senderId: string;
  senderName: string;
  content: string;
  createdAt?: string;
};

function App() {
  const [room, setRoom] = useState<Room | null>(null);
  const [roomName, setRoomName] = useState('Nhóm tư vấn nội bộ');
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState('');


  const [senderName, setSenderName] = useState(() => {
    return localStorage.getItem('senderName') || 'Phong';
  });

  const [senderId] = useState(() => {
    const saved = localStorage.getItem('senderId');

    if (saved) {
      return saved;
    }

    const newId = `user-${Date.now()}`;
    localStorage.setItem('senderId', newId);
    return newId;
  });

  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [input, setInput] = useState('');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const savedRoomId = localStorage.getItem('roomId');
    const savedRoomName = localStorage.getItem('roomName');

    if (savedRoomId && savedRoomName) {
      const restoredRoom: Room = {
        _id: savedRoomId,
        name: savedRoomName,
        type: 'group',
        enableAi: true,
      };

      setRoom(restoredRoom);
      loadMessages(savedRoomId);
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  async function createRoom() {
    if (!roomName.trim() || !senderName.trim() || isCreatingRoom) {
      return;
    }

    setIsCreatingRoom(true);

    try {
      localStorage.setItem('senderName', senderName);

      const response = await fetch(`${API_URL}/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: roomName,
          type: 'group',
          enableAi: true,
          participants: [
            {
              userId: senderId,
              displayName: senderName,
              role: 'human',
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error('Không tạo được phòng');
      }

      const data = await response.json();

      setRoom(data);
      setMessages([]);

      localStorage.setItem('roomId', data._id);
      localStorage.setItem('roomName', data.name);
    } catch (error) {
      console.error(error);
      alert('Tạo phòng thất bại. Kiểm tra backend hoặc CORS.');
    } finally {
      setIsCreatingRoom(false);
    }
  }
  async function joinRoom() {
    const roomId = joinRoomId.trim();

    if (!roomId || !senderName.trim()) {
      return;
    }

    try {
      localStorage.setItem('senderName', senderName);

      const response = await fetch(`${API_URL}/rooms/${roomId}/messages`);

      if (!response.ok) {
        throw new Error('Không tìm thấy phòng');
      }

      const data = await response.json();

      const joinedRoom: Room = {
        _id: roomId,
        name: `Phòng ${roomId.slice(-6)}`,
        type: 'group',
        enableAi: true,
      };

      setRoom(joinedRoom);
      setMessages(data);

      localStorage.setItem('roomId', roomId);
      localStorage.setItem('roomName', joinedRoom.name);
    } catch (error) {
      console.error(error);
      alert('Không tham gia được phòng. Kiểm tra Room ID hoặc backend.');
    }
  }
  async function loadMessages(roomId: string) {
    try {
      const response = await fetch(`${API_URL}/rooms/${roomId}/messages`);

      if (!response.ok) {
        throw new Error('Không lấy được tin nhắn');
      }

      const data = await response.json();
      setMessages(data);
    } catch (error) {
      console.error(error);
    }
  }

  async function sendMessage() {
    const text = input.trim();

    if (!room || !text || isSending) {
      return;
    }

    setInput('');
    setIsSending(true);

    try {
      socket.emit('send_room_message', {
        roomId: room._id,
        senderId,
        senderName,
        content: text,
        askAi: true,
      });
    } catch (error) {
      console.error(error);

      setMessages((prev) => [
        ...prev,
        {
          senderType: 'ai',
          senderId: 'system',
          senderName: 'System',
          content: 'Không gửi được tin nhắn qua realtime socket.',
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function resetRoom() {
    localStorage.removeItem('roomId');
    localStorage.removeItem('roomName');
    setRoom(null);
    setMessages([]);
  }
  useEffect(() => {
    if (!room) {
      return;
    }

    const currentRoom = room;

    function onConnect() {
      setIsSocketConnected(true);

      socket.emit('join_room', {
        roomId: currentRoom._id,
        senderId,
        senderName,
      });
    }

    function onDisconnect() {
      setIsSocketConnected(false);
    }

    function onRoomJoined(payload: { roomId: string; socketId: string }) {
      console.log('Joined room:', payload);
    }

    function onUserJoined(payload: {
      roomId: string;
      senderId: string;
      senderName: string;
    }) {
      console.log(`${payload.senderName} joined room`);
    }

    function onMessageCreated(message: RoomMessage) {
      setMessages((prev) => {
        const exists = message._id && prev.some((item) => item._id === message._id);

        if (exists) {
          return prev;
        }

        return [...prev, message];
      });
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room_joined', onRoomJoined);
    socket.on('user_joined', onUserJoined);
    socket.on('message_created', onMessageCreated);

    if (!socket.connected) {
      socket.connect();
    } else {
      onConnect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room_joined', onRoomJoined);
      socket.off('user_joined', onUserJoined);
      socket.off('message_created', onMessageCreated);
    };
  }, [room, senderId, senderName]);
  if (!room) {
    return (
      <div className="page">
        <div className="setup-card">
          <h1>AI Group Chat</h1>
          <p>Tạo phòng mới hoặc tham gia phòng có sẵn.</p>

          <label>Tên của bạn</label>
          <input
            value={senderName}
            onChange={(event) => setSenderName(event.target.value)}
            placeholder="Ví dụ: Phong"
          />

          <div className="setup-divider" />

          <h3>Tạo phòng mới</h3>

          <label>Tên phòng</label>
          <input
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            placeholder="Ví dụ: Nhóm tư vấn nội bộ"
          />

          <button onClick={createRoom} disabled={isCreatingRoom}>
            {isCreatingRoom ? 'Đang tạo...' : 'Tạo phòng chat'}
          </button>

          <div className="setup-divider" />

          <h3>Tham gia phòng</h3>

          <label>Room ID</label>
          <input
            value={joinRoomId}
            onChange={(event) => setJoinRoomId(event.target.value)}
            placeholder="Dán Room ID vào đây"
          />

          <button className="secondary-setup-button" onClick={joinRoom}>
            Tham gia phòng
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="chat-layout">
        <aside className="sidebar">
          <h2>{room.name}</h2>

          <p className="sidebar-label">Room ID</p>
          <code>{room._id}</code>

          <div className="sidebar-section">
            <strong>Realtime</strong>
            <p className={isSocketConnected ? 'status-online' : 'status-offline'}>
              {isSocketConnected ? 'Đã kết nối' : 'Mất kết nối'}
            </p>
          </div>

          <button className="secondary-button" onClick={() => loadMessages(room._id)}>
            Tải lại tin nhắn
          </button>

          <button className="danger-button" onClick={resetRoom}>
            Rời phòng
          </button>
        </aside>

        <main className="chat-panel">
          <header className="chat-header">
            <div>
              <h1>Chat nhóm với AI</h1>
              <p>AI đọc ngữ cảnh gần nhất và trả lời trong nhóm.</p>
            </div>
          </header>

          <section className="chat-body">
            {messages.length === 0 && (
              <div className="empty-state">
                Chưa có tin nhắn. Hãy bắt đầu bằng cách hỏi AI.
              </div>
            )}

            {messages.map((message, index) => {
              const isMine = message.senderId === senderId;
              const isAi = message.senderType === 'ai';
              const isOther = !isMine && !isAi;

              return (
                <div
                  key={message._id || index}
                  className={`message-row ${isMine ? 'mine' : ''} ${isAi ? 'ai' : ''
                    } ${isOther ? 'other' : ''}`}
                >
                  <div className="message-card">
                    <div className="message-meta">
                      <div className="message-name">
                        {isAi ? '🤖 ' : isMine ? '🧑 ' : '👤 '}
                        {message.senderName}
                      </div>

                      {isAi && <span className="message-badge ai-badge">AI</span>}
                      {isMine && <span className="message-badge my-badge">Tôi</span>}
                      {isOther && (
                        <span className="message-badge other-badge">Người dùng</span>
                      )}
                    </div>

                    <div className="message-content">{message.content}</div>
                  </div>
                </div>
              );
            })}

            {isSending && (
              <div className="message-row ai">
                <div className="message-card">
                  <div className="message-meta">
                    <div className="message-name">🤖 AI Assistant</div>
                    <span className="message-badge ai-badge">AI</span>
                  </div>

                  <div className="message-content typing">Đang trả lời...</div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </section>

          <footer className="chat-input">
            <input
              value={input}
              placeholder="Nhập tin nhắn..."
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  sendMessage();
                }
              }}
            />

            <button onClick={sendMessage} disabled={isSending}>
              Gửi
            </button>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default App;