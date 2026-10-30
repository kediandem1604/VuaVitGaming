/**
 * jsdom chưa có `AnimationEvent`. Thiếu nó, React (đọc lúc nạp react-dom) nghe
 * `webkitAnimationEnd` thay vì `animationend`, nên `fireEvent.animationEnd` không tới
 * được `onAnimationEnd`. Trình duyệt thật đều có, nên bổ sung bản tối thiểu ở đây,
 * trước khi file test nào nạp React.
 */

if (!('AnimationEvent' in globalThis)) {
  class AnimationEvent extends Event {
    readonly animationName: string;
    readonly elapsedTime: number;
    readonly pseudoElement: string;

    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init);
      this.animationName = init.animationName ?? '';
      this.elapsedTime = init.elapsedTime ?? 0;
      this.pseudoElement = init.pseudoElement ?? '';
    }
  }
  Object.defineProperty(globalThis, 'AnimationEvent', { value: AnimationEvent, configurable: true, writable: true });
}
