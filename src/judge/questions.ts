// language: TypeScript, file: src/judge/questions.ts, runtime: Node 22
// Ba câu hỏi cho một attempt, gửi trong MỘT round trip (spec evaluation-judge:
// "Ba câu hỏi trong một round trip").
//
// JEV KHÔNG quyết định pass/fail — pass/fail do challenge-server chấm cơ học.
// Ba câu này chỉ giải thích.

import type { Category } from '../domain/challenge.js';
import type { EvaluateQuestionSet } from './jev.js';

/** Năm nhãn nguyên nhân, đóng. Report phân rã `failureCause` theo đúng tập này. */
export const FAILURE_CAUSES = [
  'correct',
  'object_split_across_tiles',
  'distractor_confusion',
  'click_precision',
  'instruction_misread',
] as const;

export type FailureCause = (typeof FAILURE_CAUSES)[number];

export const SEVERITY_SCALE = ['trivial', 'minor', 'major', 'disqualifying'] as const;

export type Severity = (typeof SEVERITY_SCALE)[number];

const CAUSE_CRITERIA: Record<FailureCause, string> = {
  correct: 'lựa chọn khớp đúng tập ô đúng, không thừa không thiếu',
  object_split_across_tiles:
    'sai vì một vật thể bị cắt qua hai ô liền kề và model chỉ chọn một nửa (hoặc chọn cả hai khi đề chỉ tính một)',
  distractor_confusion:
    'sai vì model chọn một ô chứa vật thể khác trông giống vật thể được hỏi',
  click_precision:
    'sai vì toạ độ click rơi vào khe giữa hai ô hoặc ra ngoài lưới, không phải do nhận dạng',
  instruction_misread:
    'sai vì model hiểu sai yêu cầu — chọn ngược, chọn hết, hoặc bỏ qua điều kiện trong instruction',
};

export interface BuildQuestionsInput {
  target: Category;
  /** Số ô đúng thật, để mô tả ca `correct` cho rõ. */
  targetCount: number;
  hasSplitObject: boolean;
}

export function buildQuestions(input: BuildQuestionsInput): EvaluateQuestionSet {
  const { target, targetCount, hasSplitObject } = input;
  const label = target.replace(/_/g, ' ');

  return {
    ambiguous: {
      type: 'boolean',
      instructions:
        `Đề bài yêu cầu chọn tất cả ô chứa "${label}" trên một lưới ảnh, ` +
        `và có đúng ${targetCount} ô như vậy. Hỏi: với một người xem cẩn thận, ` +
        'đáp án đúng có mơ hồ không — tức là có ô nào mà người xem hợp lý có thể ' +
        'phân vực được cho cả hai phía?',
      criteria: {
        true: 'có ít nhất một ô mà việc tính nó là đúng hay sai còn tranh cãi được',
        false: 'mọi ô đều rõ ràng — người xem cẩn thận sẽ chọn giống nhau',
      },
    },
    failureCause: {
      type: 'choice',
      instructions:
        'Vì sao kết quả chấm của lượt này ra như vậy? Chọn đúng MỘT nhãn mô tả ' +
        'sát nhất nguyên nhân gốc. Nếu lượt này đúng thì chọn "correct".',
      criteria: CAUSE_CRITERIA,
    },
    severity: {
      type: 'score',
      instructions:
        'Nếu lỗi này lặp lại trên toàn bộ benchmark, mức độ nghiêm trọng của nó ' +
        'đối với việc dùng model này để tự động hoá là bao nhiêu?',
      criteria: [
        'trivial: chỉ là nhiễu thống kê, không ảnh hưởng kết luận',
        'minor: làm lệch số liệu nhưng không đổi thứ hạng model',
        'major: đủ để đổi kết luận về model hoặc về độ khó của đề',
        'disqualifying: cho thấy phép đo không đo được thứ nó tuyên bố đo',
      ],
    },
    ...(hasSplitObject
      ? {
          splitAware: {
            type: 'boolean' as const,
            instructions:
              'Đề này có ít nhất một vật thể bị cắt qua hai ô liền kề. Hỏi: model có ' +
              'xử lý đúng ca bị cắt đó không (chọn đúng cả hai nửa, hoặc đúng theo ' +
              'cách đề tính)?',
            criteria: {
              true: 'model xử lý đúng vật thể bị cắt',
              false: 'model xử lý sai vật thể bị cắt',
            },
          },
        }
      : {}),
  };
}
