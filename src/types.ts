import type { Page } from 'playwright';
import type { OpenSchedule, RecurringSchedule } from './schedule.js';

/** 예약 가능한 자리 하나. */
export interface Slot {
  /** 중복 알림을 막기 위한 안정적인 식별자. */
  id: string;
  /** 사람이 읽는 표기. 예: "2026-09-05 19:00 · 2인 · 창가석" */
  label: string;
  date: string;
  time?: string;
  party?: number;
  /** 장소 예약처럼 대상이 여러 개일 때의 식별자. 예: "311" */
  room?: string;
  price?: string;
  url?: string;
  /**
   * 이 슬롯을 발견한 목록 페이지의 URL.
   * 예약할 때 같은 페이지를 다시 열어 같은 자리를 정확히 찾아가기 위해 씁니다.
   */
  searchUrl?: string;
}

/** 사용자가 잡고 싶은 조건. */
export interface JobTarget {
  /** 노릴 날짜들. YYYY-MM-DD. schedule 이 있으면 매 회차마다 다시 계산됩니다. */
  dates: string[];
  /**
   * 후보 대상들. 앞에서부터 순서대로 확인하며, 먼저 비어 있는 곳을 잡습니다.
   * 프로필의 urlTemplate 안 {room} 으로 치환됩니다.
   *
   * 사이트가 내부 코드를 쓰는 경우엔 코드와 표시 이름을 함께 적을 수 있습니다.
   *   ["311", "312"]                              코드가 곧 이름일 때
   *   [{ "id": "26", "label": "311호" }, …]        코드와 이름이 다를 때
   */
  rooms?: (string | RoomRef)[];
  /** 이 시각 이후 (HH:mm) */
  timeFrom?: string;
  /** 이 시각 이전 (HH:mm) */
  timeTo?: string;
  party?: number;
  /** 라벨에 반드시 포함되어야 하는 문자열들 */
  keywords?: string[];
  /** 라벨에 하나라도 포함되면 제외 */
  exclude?: string[];
}

export interface RoomRef {
  /** urlTemplate 의 {room} 에 들어갈 값. */
  id: string;
  /** 로그와 알림에 표시할 이름. 없으면 id 를 씁니다. */
  label?: string;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface BookingResult {
  ok: boolean;
  /** dry-run 이라 최종 확정 직전에 멈춘 경우 true */
  stoppedBeforeConfirm?: boolean;
  confirmationCode?: string;
  message: string;
  screenshot?: string;
}

/**
 * 사이트 하나를 다루는 방법. 새 사이트를 붙이려면
 * 이 인터페이스만 구현하면 나머지(감시 루프·알림·CLI)는 그대로 재사용됩니다.
 */
export interface SiteAdapter {
  name: string;
  /** 저장된 세션이 아직 살아있는지 확인. */
  isLoggedIn(page: Page): Promise<boolean>;
  /** 로그인 수행. manual 모드면 사용자가 직접 입력할 때까지 기다립니다. */
  login(page: Page, creds: Credentials, opts: { manual: boolean }): Promise<void>;
  /** 조건에 맞는 빈자리 목록을 반환. 없으면 빈 배열. */
  findSlots(page: Page, target: JobTarget): Promise<Slot[]>;
  /** 슬롯 하나를 실제로 예약. dryRun 이면 최종 확정 직전에 멈춥니다. */
  book(page: Page, slot: Slot, opts: { dryRun: boolean }): Promise<BookingResult>;
}

/** config/*.job.json 의 형태. */
export interface JobConfig {
  name: string;
  /** 사용할 어댑터: 프로필 JSON 경로, 또는 내장 어댑터 이름("mock"). */
  adapter: string;
  target: JobTarget;
  /**
   * "매월 둘째주·넷째주 토요일" 같은 반복 일정.
   * 지정하면 target.dates 를 매 회차마다 이 일정으로 다시 계산합니다.
   */
  schedule?: RecurringSchedule;
  watch?: {
    /** 폴링 간격(초). 최소 5초. */
    intervalSec?: number;
    /** 매 요청마다 ±jitterSec 만큼 무작위로 흔들어 패턴을 없앱니다. */
    jitterSec?: number;
    /** 빈자리를 찾으면 자동으로 예약까지 시도할지. */
    autoBook?: boolean;
    /** 예약 성공(또는 dry-run 도달) 후 워커를 종료할지. */
    stopAfterBooking?: boolean;
    /** 이 시각 범위에는 폴링을 쉽니다. 예: ["01:00", "07:00"] */
    quietHours?: [string, string];
    /** 이 시각이 지나면 워커를 종료합니다. ISO 8601. */
    until?: string;
    /** 연속 실패 허용 횟수. 초과하면 종료. */
    maxConsecutiveErrors?: number;
    /**
     * 예약이 열리는 시각 (오픈런). 지정하면 그때까지 조용히 기다리다가
     * 오픈 직전부터 burst 간격으로 몰아서 확인합니다.
     */
    openAt?: OpenSchedule;
    /** 오픈 시각 전후로 빠르게 확인하는 구간. */
    burst?: {
      /** 오픈 몇 초 전부터 몰아치기 시작할지. 기본 30 */
      beforeSec?: number;
      /** 오픈 후 몇 초 동안 유지할지. 기본 300 */
      afterSec?: number;
      /** 몰아치는 동안의 간격(밀리초). 최소 500. 기본 1000 */
      intervalMs?: number;
    };
    /** true 면 오픈 구간에만 확인하고, 그 밖의 시간에는 대기만 합니다. */
    onlyAtOpen?: boolean;
    /**
     * 한 회차에서 확인할 날짜 수 상한 (가까운 날짜부터).
     * 오픈 순간에 아직 열리지 않은 먼 날짜까지 훑느라 시간을 쓰지 않도록 1 로 두면 좋습니다.
     */
    maxDates?: number;
  };
}
