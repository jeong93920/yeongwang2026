-- 예시 입금 계좌. 실제 계좌가 확정되면 다시 덮어써야 합니다.
update public.booth_settings
set account_holder = '백선재',
    account_number = '35200000000',
    -- 이전 부스(고예훈) 카카오페이 송금 링크가 그대로 남아 있었습니다.
    -- 예금주가 바뀌었는데 링크를 두면 손님 돈이 이전 예금주에게 갑니다. 비워 둡니다.
    transfer_qr_url = null
where id = true;
