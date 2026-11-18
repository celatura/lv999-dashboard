'use client';

import { Icons } from '@/components/icons';
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle
} from '@/components/ui/questionnaire';
import type { AskUserToolPart } from './ask-user-part';

/**
 * 澄清提问卡片：吸收 askUser 工具调用的输入，回答后经 addToolOutput 回传并自动续答。
 * 吸附在消息滚动区底部（sticky），不打断正在浏览的历史内容。
 */
export function QuestionCard({
  part,
  onAnswer
}: {
  part: AskUserToolPart;
  onAnswer: (toolCallId: string, answers: { question: string; answer: string }[]) => void;
}) {
  const questions = part.state === 'input-available' ? (part.input?.questions ?? []) : [];

  return (
    <div className='sticky bottom-2 isolate z-50 mx-auto w-full max-w-3xl px-4 pt-2'>
      <div className='bg-popover text-popover-foreground ring-foreground/5 w-full rounded-3xl p-4 text-sm shadow-lg ring-1 dark:ring-foreground/10'>
        {questions.length === 0 ? (
          <div className='text-muted-foreground flex items-center gap-2 py-2'>
            <Icons.spinner className='size-4 animate-spin' />
            正在准备澄清问题…
          </div>
        ) : (
          <>
            <div className='text-muted-foreground mb-3 flex items-center gap-1.5 text-xs'>
              <Icons.sparkles className='size-3.5' />
              Agent 想先确认 {questions.length} 个创作细节
            </div>
            <Questionnaire
              key={part.toolCallId}
              defaultItem='q0'
              items={questions.map((question, index) => ({
                choices: question.choices.map((choice) => ({ value: choice })),
                name: `q${index}`,
                required: true
              }))}
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                onAnswer(
                  part.toolCallId,
                  questions.map((question, index) => ({
                    question: question.question,
                    answer: String(formData.get(`q${index}`) ?? '')
                  }))
                );
              }}
            >
              {questions.length > 1 && (
                <QuestionnaireProgress
                  aria-label='问题进度'
                  className='-mb-4'
                  render={(props, state) => (
                    <div {...props}>
                      第 {state.current} / {state.total} 题
                    </div>
                  )}
                />
              )}
              {questions.map((question, index) => (
                <QuestionnaireItem key={question.question} name={`q${index}`} required>
                  <QuestionnaireTitle>{question.question}</QuestionnaireTitle>
                  <QuestionnaireChoices>
                    {question.choices.map((choice) => (
                      <QuestionnaireChoice key={choice} value={choice}>
                        {choice}
                      </QuestionnaireChoice>
                    ))}
                    <QuestionnaireInput aria-label='其他回答' placeholder='或在此输入你的回答…' />
                  </QuestionnaireChoices>
                  <QuestionnaireError>请选择一个选项或填写回答。</QuestionnaireError>
                </QuestionnaireItem>
              ))}
              <QuestionnaireActions>
                <QuestionnairePrevious />
                <QuestionnaireNext />
                <QuestionnaireSubmit>提交回答</QuestionnaireSubmit>
              </QuestionnaireActions>
            </Questionnaire>
          </>
        )}
      </div>
    </div>
  );
}
