import { useChat } from '@ai-sdk/react';
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  MyMessage,
  ToolRequiringApproval,
} from '../api/chat.ts';
import { ChatInput, Message, Wrapper } from './components.tsx';
import './tailwind.css';

const App = () => {
  const { messages, sendMessage } = useChat<MyMessage>({});

  const [input, setInput] = useState(
    `Send an email to team@aihero.dev saying what a fantastic AI workshop I'm currently attending. Thank them for the workshop.`,
  );

  const toolIdsWithDecisionsMade = useMemo(() => {
    const decisionsByToolId = new Set(
      messages
        .flatMap((message) => message.parts)
        .filter((part) => part.type === 'data-approval-decision')
        .map((part) => part.data.toolId),
    );

    return decisionsByToolId;
  }, [messages]);

  const [toolGivingFeedbackOn, setToolGivingFeedbackOn] =
    useState<ToolRequiringApproval | null>(null);

  return (
    <Wrapper
      messages={messages.map((message) => (
        <Message
          key={message.id}
          role={message.role}
          parts={message.parts}
          toolIdsWithDecisionsMade={toolIdsWithDecisionsMade}
          onToolDecision={(tool, decision) => {
            if (decision === 'approve') {
              sendMessage({
                parts: [
                  {
                    type: 'data-approval-decision',
                    data: {
                      toolId: tool.id,
                      decision: { type: 'approve' },
                    },
                  },
                ],
              });
              return;
            }

            setInput('');
            setToolGivingFeedbackOn(tool);
          }}
        />
      ))}
      input={
        <ChatInput
          isGivingFeedback={Boolean(toolGivingFeedbackOn)}
          input={input}
          onChange={(e) => setInput(e.target.value)}
          onSubmit={(e) => {
            e.preventDefault();

            if (toolGivingFeedbackOn) {
              sendMessage({
                parts: [
                  {
                    type: 'data-approval-decision',
                    data: {
                      toolId: toolGivingFeedbackOn.id,
                      decision: {
                        type: 'reject',
                        reason: input,
                      },
                    },
                  },
                ],
              });

              setToolGivingFeedbackOn(null);
              setInput('');
              return;
            }

            sendMessage({
              text: input,
            });
            setInput('');
          }}
        />
      }
    />
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
