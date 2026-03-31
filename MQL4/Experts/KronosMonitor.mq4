//+------------------------------------------------------------------+
//|                                              KronosMonitor.mq4   |
//|                          Kronos Account Monitor EA               |
//+------------------------------------------------------------------+
#property copyright "KronosMonitor"
#property version   "2.00"
#property strict

//--- 接続設定
input string AccountServer    = "XMTrading-Real 31";  // 接続サーバー
input int    AccountId        = 41137395;             // MT4口座ID

//--- マジックナンバー（2つのEAを監視）
input int    MAGIC1           = 414;     // マジックナンバー1
input int    MAGIC2           = 643;     // マジックナンバー2

//--- 出力設定
input string OutputFile       = "kronos_status.json";     // ステータス出力
input string HeartbeatFile    = "kronos_heartbeat.json";  // ハートビート出力
input int    Interval         = 30;      // 送信間隔（秒）

//--- グローバル
datetime g_lastBeat = 0;

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit()
{
   EventSetTimer(Interval);
   Print("KronosMonitor v2.0 started. Server=", AccountServer,
         " AccountId=", AccountId,
         " MAGIC1=", MAGIC1, " MAGIC2=", MAGIC2,
         " Interval=", Interval, "s");
   WriteHeartbeat();
   WriteStatus();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("KronosMonitor stopped. reason=", reason);
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   if (TimeCurrent() - g_lastBeat < Interval)
      return;
   g_lastBeat = TimeCurrent();
   WriteHeartbeat();
   WriteStatus();
}

//+------------------------------------------------------------------+
//| OnTimer (バックアップ: ティックが来ない時間帯用)                 |
//+------------------------------------------------------------------+
void OnTimer()
{
   if (TimeCurrent() - g_lastBeat < Interval)
      return;
   g_lastBeat = TimeCurrent();
   WriteHeartbeat();
   WriteStatus();
}

//+------------------------------------------------------------------+
//| MAGIC1 または MAGIC2 に一致するか判定                             |
//+------------------------------------------------------------------+
bool IsMagicMatch(int magic)
{
   return (magic == MAGIC1 || magic == MAGIC2);
}

//+------------------------------------------------------------------+
//| ハートビートJSON書き出し                                          |
//+------------------------------------------------------------------+
void WriteHeartbeat()
{
   string ts = TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS);
   StringReplace(ts, ".", "-");  // 2026.03.31 → 2026-03-31
   // スペースをTに変換
   int spacePos = StringFind(ts, " ");
   if (spacePos >= 0)
   {
      ts = StringSubstr(ts, 0, spacePos) + "T" + StringSubstr(ts, spacePos + 1);
   }

   string json = "{\"timestamp\":\"" + ts + "\"}";

   int handle = FileOpen(HeartbeatFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if (handle != INVALID_HANDLE)
   {
      FileWriteString(handle, json);
      FileClose(handle);
   }
   else
   {
      Print("KronosMonitor: HeartbeatFile open failed. error=", GetLastError());
   }
}

//+------------------------------------------------------------------+
//| ステータスJSON書き出し                                            |
//+------------------------------------------------------------------+
void WriteStatus()
{
   double bal    = AccountBalance();
   double eq     = AccountEquity();
   double margin = AccountMargin();
   double freeM  = AccountFreeMargin();

   //--- DD%計算: (balance - equity) / balance * 100
   double dd = 0.0;
   if (bal > 0 && eq < bal)
      dd = (bal - eq) / bal * 100.0;

   //--- 両magic合算ポジション数カウント + JSON収集
   int nd = 0;
   string positions = BuildPositionsJson(nd);

   //--- タイムスタンプ (ISO形式)
   string ts = TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS);
   StringReplace(ts, ".", "-");
   int spacePos = StringFind(ts, " ");
   if (spacePos >= 0)
   {
      ts = StringSubstr(ts, 0, spacePos) + "T" + StringSubstr(ts, spacePos + 1);
   }

   //--- JSON組み立て
   string json = "{";
   json += "\"account_id\":" + IntegerToString(AccountId) + ",";
   json += "\"server\":\"" + AccountServer + "\",";
   json += "\"timestamp\":\"" + ts + "\",";
   json += "\"balance\":" + DoubleToString(bal, 2) + ",";
   json += "\"equity\":" + DoubleToString(eq, 2) + ",";
   json += "\"margin\":" + DoubleToString(margin, 2) + ",";
   json += "\"free_margin\":" + DoubleToString(freeM, 2) + ",";
   json += "\"dd_percent\":" + DoubleToString(dd, 2) + ",";
   json += "\"positions\":" + positions + ",";
   json += "\"position_count\":" + IntegerToString(nd) + ",";
   json += "\"nd\":" + IntegerToString(nd) + ",";
   json += "\"active\":true";
   json += "}";

   //--- ファイル書き出し (MQL4/Files/kronos_status.json)
   int handle = FileOpen(OutputFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if (handle != INVALID_HANDLE)
   {
      FileWriteString(handle, json);
      FileClose(handle);
   }
   else
   {
      Print("KronosMonitor: OutputFile open failed. error=", GetLastError());
   }
}

//+------------------------------------------------------------------+
//| MAGIC一致ポジションのJSON配列を生成（両magic対応）                |
//| ndに合算ポジション数を返す                                        |
//+------------------------------------------------------------------+
string BuildPositionsJson(int &nd)
{
   string result = "[";
   bool first = true;
   nd = 0;

   for (int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      if (!IsMagicMatch(OrderMagicNumber()))
         continue;

      nd++;
      if (!first) result += ",";
      first = false;

      //--- type文字列
      string typeStr = "unknown";
      if (OrderType() == OP_BUY)       typeStr = "buy";
      else if (OrderType() == OP_SELL)  typeStr = "sell";

      //--- current_price
      double curPrice = 0.0;
      if (OrderType() == OP_BUY)
         curPrice = MarketInfo(OrderSymbol(), MODE_BID);
      else if (OrderType() == OP_SELL)
         curPrice = MarketInfo(OrderSymbol(), MODE_ASK);

      //--- open_time (ISO形式)
      string openTs = TimeToString(OrderOpenTime(), TIME_DATE|TIME_SECONDS);
      StringReplace(openTs, ".", "-");
      int sp = StringFind(openTs, " ");
      if (sp >= 0)
      {
         openTs = StringSubstr(openTs, 0, sp) + "T" + StringSubstr(openTs, sp + 1);
      }

      result += "{";
      result += "\"ticket\":" + IntegerToString(OrderTicket()) + ",";
      result += "\"magic\":" + IntegerToString(OrderMagicNumber()) + ",";
      result += "\"type\":\"" + typeStr + "\",";
      result += "\"lots\":" + DoubleToString(OrderLots(), 2) + ",";
      result += "\"symbol\":\"" + OrderSymbol() + "\",";
      result += "\"open_price\":" + DoubleToString(OrderOpenPrice(), 2) + ",";
      result += "\"current_price\":" + DoubleToString(curPrice, 2) + ",";
      result += "\"profit\":" + DoubleToString(OrderProfit(), 0) + ",";
      result += "\"open_time\":\"" + openTs + "\"";
      result += "}";
   }

   result += "]";
   return result;
}
//+------------------------------------------------------------------+
