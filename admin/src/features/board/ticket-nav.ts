/** True when the open ticket was reached from a board card (so closing it goes back in history). */
let fromCard = false;

export const markFromCard = (value: boolean) => {
  fromCard = value;
};
export const isFromCard = () => fromCard;
