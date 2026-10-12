-- 토스 송금 버튼 확인용 예시 계좌입니다. 실제로 돈을 받을 수 없는 번호이므로
-- 행사 전에 반드시 실제 은행·계좌번호·예금주로 다시 덮어써야 합니다.
-- 토스 버튼 링크는 이 값으로 자동 생성됩니다: supertoss://send?amount=…&bank=…&accountNo=…
update public.booth_settings
set bank_name = '토스뱅크',
    account_holder = '예시',
    account_number = '100000000000'
where id = true;
